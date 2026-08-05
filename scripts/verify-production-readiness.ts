// Production-readiness verification — run manually before/after a
// security-sensitive deploy (e.g. `npx tsx scripts/verify-production-readiness.ts`,
// or `npm run verify:production` from the repo root). Not part of CI: it
// makes real network calls against whatever DATABASE_URL/API_PUBLIC_URL/
// SRS_* env vars are set in the shell it runs in, which only makes sense
// as a deliberate, human-triggered check against a specific real
// environment (matching db/migrate.mjs's own standalone-script
// convention — plain env vars, no framework, run with `--env-file`).
//
// Zero-trust note: every value this script reads comes from
// process.env, read server-side by this script's own process — nothing
// here trusts a client-supplied or frontend-bundled value for anything
// security-relevant, consistent with the "never rely on client-side
// environment variables" constraint.
import pg from "pg";

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, status: CheckResult["status"], detail: string): void {
  results.push({ name, status, detail });
  const icon = status === "pass" ? "✓" : status === "fail" ? "✗" : "⊘";
  console.log(`${icon} [${status.toUpperCase()}] ${name} — ${detail}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// =====================================================================
// 1. Database schema integrity + role isolation
// =====================================================================
//
// "Verify RLS isolation policies" (as originally specified) doesn't
// apply to this checked out — this app has no Postgres Row-Level
// Security policies, and deliberately so: see
// db/migrations/0026_rbac_role_isolation.sql's own adversarial-reasoning
// header for the full explanation (a single shared DATABASE_URL service
// account handles every request, so an RLS policy keyed on
// current_user/session_user would be non-functional here — the real
// boundary is application-level, re-checked live on every request via
// apps/api/src/app.ts's requireAdmin/requireRole/requirePermission).
// What this section verifies instead is the real, functioning
// equivalent: the schema-level constraint that bounds which role values
// can ever exist, and that the role_permissions capability table
// (which nothing in the API ever writes to at runtime — grepped, zero
// write call sites outside the migration's own seed data) still holds
// exactly the expected, reviewed capability set.
async function verifyDatabaseRoleIsolation(client: pg.Client): Promise<void> {
  const EXPECTED_ROLES = ["viewer", "creator", "moderator", "super_admin", "finance_auditor"].sort();

  const constraintResult = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'users_role_check'`
  );
  const constraintDef = constraintResult.rows[0]?.definition;
  if (!constraintDef) {
    record("users.role CHECK constraint exists", "fail", "users_role_check not found — migration 0026 not applied?");
  } else {
    const missingRole = EXPECTED_ROLES.find((role) => !constraintDef.includes(`'${role}'`));
    const stillAllowsLegacyAdmin = /'admin'(?!_)/.test(constraintDef);
    if (missingRole) {
      record("users.role CHECK constraint is current", "fail", `missing expected role '${missingRole}' in: ${constraintDef}`);
    } else if (stillAllowsLegacyAdmin) {
      record("users.role CHECK constraint is current", "fail", `still permits legacy 'admin' value: ${constraintDef}`);
    } else {
      record("users.role CHECK constraint is current", "pass", "matches the post-migration 0026 role set exactly");
    }
  }

  // Every actual users.role value in the database must be inside the
  // allowed set — a defensive check independent of the CHECK constraint
  // itself (the constraint could be correct while a bulk-loaded/legacy
  // row somehow bypassed it, e.g. a direct psql INSERT during an
  // incident — parameterized, no string interpolation of user input,
  // this is a fixed literal list, not request-derived).
  const orphanedRoles = await client.query<{ role: string; count: string }>(
    `SELECT role, count(*) AS count FROM users
     WHERE role NOT IN ('viewer', 'creator', 'moderator', 'super_admin', 'finance_auditor')
     GROUP BY role`
  );
  if (orphanedRoles.rows.length > 0) {
    const summary = orphanedRoles.rows.map((r) => `${r.role} (${r.count})`).join(", ");
    record("No users hold an out-of-set role value", "fail", `found: ${summary}`);
  } else {
    record("No users hold an out-of-set role value", "pass", "every users.role value is within the allowed set");
  }

  const rolePermissionsResult = await client.query<{
    role: string;
    can_manage_users: boolean;
    can_moderate_content: boolean;
    can_view_financials: boolean;
    can_manage_admin_config: boolean;
  }>(`SELECT role, can_manage_users, can_moderate_content, can_view_financials, can_manage_admin_config FROM role_permissions`);

  const byRole = new Map(rolePermissionsResult.rows.map((row) => [row.role, row]));
  const missingFromTable = EXPECTED_ROLES.filter((role) => !byRole.has(role));
  if (missingFromTable.length > 0) {
    record("role_permissions has one row per role", "fail", `missing rows for: ${missingFromTable.join(", ")}`);
  } else {
    record("role_permissions has one row per role", "pass", `all ${EXPECTED_ROLES.length} roles present`);
  }

  // super_admin must hold every capability, and no lower tier should
  // accidentally have been seeded with super_admin-equivalent access —
  // the actual privilege-escalation-prevention property this table
  // exists to guarantee.
  const superAdmin = byRole.get("super_admin");
  const superAdminHasEverything =
    !!superAdmin &&
    superAdmin.can_manage_users &&
    superAdmin.can_moderate_content &&
    superAdmin.can_view_financials &&
    superAdmin.can_manage_admin_config;
  record(
    "super_admin holds every capability",
    superAdminHasEverything ? "pass" : "fail",
    superAdmin ? JSON.stringify(superAdmin) : "no super_admin row found"
  );

  const viewer = byRole.get("viewer");
  const creator = byRole.get("creator");
  const viewerCreatorHaveNothing = [viewer, creator].every(
    (row) => !!row && !row.can_manage_users && !row.can_moderate_content && !row.can_view_financials && !row.can_manage_admin_config
  );
  record(
    "viewer/creator hold zero admin-tier capabilities",
    viewerCreatorHaveNothing ? "pass" : "fail",
    `viewer=${JSON.stringify(viewer)}, creator=${JSON.stringify(creator)}`
  );
}

// =====================================================================
// 2. SRS admin API isolation — public port must 403, internal must 200
// =====================================================================
async function verifySrsAdminIsolation(): Promise<void> {
  // The public, internet-facing WHIP-signaling port — see
  // infra/srs/conf/whip-proxy.nginx.conf and infra/srs/fly.toml for why
  // this is fronted by a path-filtering proxy rather than SRS directly.
  // Overridable since the production hostname isn't hardcoded elsewhere
  // in this codebase either (SRS_HTTP_HOST/NEXT_PUBLIC_SRS_WHIP_URL are
  // both env-driven for the same reason: local dev vs. production).
  const publicBase = process.env.SRS_PUBLIC_ADMIN_CHECK_URL ?? "https://habeshalive-srs.fly.dev:8443";
  try {
    const res = await fetchWithTimeout(`${publicBase}/api/v1/clients/`, {}, 5000);
    if (res.status === 403) {
      record("SRS admin API is blocked on the public port", "pass", `${publicBase}/api/v1/clients/ → HTTP 403`);
    } else {
      record(
        "SRS admin API is blocked on the public port",
        "fail",
        `${publicBase}/api/v1/clients/ → HTTP ${res.status}, expected 403 — see infra/srs/conf/whip-proxy.nginx.conf`
      );
    }
  } catch (err) {
    record("SRS admin API is blocked on the public port", "fail", `request itself failed: ${(err as Error).message}`);
  }

  // The private, Fly-6PN-only base — see apps/api/src/common/env.ts's
  // SRS_ADMIN_API_BASE. This check can only genuinely succeed when run
  // from inside Fly's private network (a `flyctl ssh console` session on
  // either app, or a one-off machine in the same org) — from a laptop or
  // most CI runners, SRS_ADMIN_API_BASE (an *.internal hostname) simply
  // won't resolve/won't be routable at all. That's treated as SKIP, not
  // FAIL: a DNS/connection failure here proves nothing about whether the
  // internal endpoint is correctly configured, only that this script
  // isn't running somewhere that can reach it.
  const internalBase = process.env.SRS_ADMIN_API_BASE;
  if (!internalBase) {
    record("SRS admin API is reachable on the internal base", "skip", "SRS_ADMIN_API_BASE is not set in this shell");
    return;
  }
  try {
    const res = await fetchWithTimeout(`${internalBase}/api/v1/clients/`, {}, 5000);
    if (res.status === 200) {
      record("SRS admin API is reachable on the internal base", "pass", `${internalBase}/api/v1/clients/ → HTTP 200`);
    } else {
      record(
        "SRS admin API is reachable on the internal base",
        "fail",
        `${internalBase}/api/v1/clients/ → HTTP ${res.status}, expected 200`
      );
    }
  } catch (err) {
    record(
      "SRS admin API is reachable on the internal base",
      "skip",
      `unreachable from this machine (${(err as Error).message}) — only meaningful when run from inside Fly's private network`
    );
  }
}

// =====================================================================
// 3. WHEP endpoints stay inert while feature flags are unset
// =====================================================================
async function verifyWhepInert(): Promise<void> {
  const apiBase = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
  // Any syntactically valid UUID works — whep-routes.ts's WHEP_ENABLED
  // check is the very first thing the handler does, before any stream
  // lookup, so this 503s regardless of whether a real stream exists.
  const placeholderStreamId = "00000000-0000-0000-0000-000000000000";
  try {
    const res = await fetchWithTimeout(
      `${apiBase}/streams/${placeholderStreamId}/whep`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offerSdp: "v=0" }) },
      5000
    );
    if (res.status === 503) {
      record("WHEP broker route is inert (WHEP_ENABLED unset)", "pass", `POST ${apiBase}/streams/:id/whep → HTTP 503`);
    } else if (res.status === 404) {
      record(
        "WHEP broker route is inert (WHEP_ENABLED unset)",
        "fail",
        `POST ${apiBase}/streams/:id/whep → HTTP 404 — route isn't registered at all, not just gated off`
      );
    } else {
      record(
        "WHEP broker route is inert (WHEP_ENABLED unset)",
        "fail",
        `POST ${apiBase}/streams/:id/whep → HTTP ${res.status}, expected 503 — is WHEP_ENABLED set? See docs/whep-rollout.md before treating that as intentional.`
      );
    }
  } catch (err) {
    record("WHEP broker route is inert (WHEP_ENABLED unset)", "fail", `request itself failed: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await verifyDatabaseRoleIsolation(client);
  } finally {
    await client.end();
  }

  await verifySrsAdminIsolation();
  await verifyWhepInert();

  console.log("");
  const failed = results.filter((r) => r.status === "fail");
  const skipped = results.filter((r) => r.status === "skip");
  const passed = results.filter((r) => r.status === "pass");
  console.log(`${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped.`);

  if (failed.length > 0) {
    console.log("\nFailed checks:");
    for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-production-readiness crashed:", err);
  process.exit(1);
});
