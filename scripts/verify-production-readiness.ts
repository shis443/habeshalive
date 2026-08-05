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

// AbortController alone isn't always enough of a guarantee — confirmed
// live: a hairpin-NAT-style hang partway through a TLS handshake (a
// machine calling its own sibling app's public hostname from inside
// Fly's private network — see the public-SRS check's own comment) left a
// plain abort()-on-timeout fetch() hanging well past its stated timeout,
// with the process never returning control. `Promise.race` against an
// independent rejecting timer is a hard backstop that doesn't depend on
// the abort signal actually unsticking whatever the socket is doing.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  const hardTimeout = new Promise<never>((_, reject) => {
    hardTimer = setTimeout(() => reject(new Error(`hard timeout after ${timeoutMs + 1000}ms`)), timeoutMs + 1000);
  });
  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }), hardTimeout]);
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(hardTimer);
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
// can ever exist, and that the role_permission_grants capability table
// (0027_permission_grants.sql — which nothing in the API ever writes to
// at runtime, grepped, zero write call sites outside the migration's own
// seed data) still holds
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

  // db/migrations/0027_permission_grants.sql replaced the fixed
  // four-boolean-column role_permissions table (0026) with a proper
  // many-to-many role_permission_grants table — see that migration's own
  // header for why. This section checks the table that's actually live
  // in production today, not the superseded one.
  const EXPECTED_GRANTS: Record<string, string[]> = {
    viewer: [],
    creator: [],
    moderator: ["chat:moderate"],
    finance_auditor: ["finance:audit"],
    super_admin: ["chat:moderate", "stream:kick", "finance:audit", "admin:manage_settings", "admin:manage_users"],
  };

  const grantsResult = await client.query<{ role: string; permission: string }>(
    `SELECT role, permission FROM role_permission_grants ORDER BY role, permission`
  );
  const grantsByRole = new Map<string, Set<string>>();
  for (const row of grantsResult.rows) {
    if (!grantsByRole.has(row.role)) grantsByRole.set(row.role, new Set());
    grantsByRole.get(row.role)!.add(row.permission);
  }

  for (const [role, expectedPermissions] of Object.entries(EXPECTED_GRANTS)) {
    const actual = grantsByRole.get(role) ?? new Set<string>();
    const missing = expectedPermissions.filter((p) => !actual.has(p));
    const unexpected = [...actual].filter((p) => !expectedPermissions.includes(p));
    if (missing.length > 0 || unexpected.length > 0) {
      record(
        `role_permission_grants for '${role}' matches the reviewed set`,
        "fail",
        `missing=[${missing.join(", ")}] unexpected=[${unexpected.join(", ")}]`
      );
    } else {
      record(
        `role_permission_grants for '${role}' matches the reviewed set`,
        "pass",
        expectedPermissions.length > 0 ? expectedPermissions.join(", ") : "(no grants, as expected)"
      );
    }
  }

  // The one privilege-escalation-sensitive check worth calling out on
  // its own, not just folded into the loop above: finance_auditor must
  // never hold chat:moderate or any admin:* grant — "auditor" implies
  // read-only financial inspection, and any of those would be a real
  // escalation hiding behind an audit-sounding role name (see
  // 0027_permission_grants.sql's own header).
  const financeAuditorGrants = grantsByRole.get("finance_auditor") ?? new Set<string>();
  const financeAuditorIsScopedCorrectly =
    !financeAuditorGrants.has("chat:moderate") &&
    !financeAuditorGrants.has("stream:kick") &&
    !financeAuditorGrants.has("admin:manage_settings") &&
    !financeAuditorGrants.has("admin:manage_users");
  record(
    "finance_auditor holds no moderation/admin/settings grants",
    financeAuditorIsScopedCorrectly ? "pass" : "fail",
    `grants=[${[...financeAuditorGrants].join(", ")}]`
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
  // A connection-level failure here (timeout/reset, not a real HTTP
  // response) is treated as SKIP, not FAIL — confirmed live: running this
  // script from *inside* Fly's private network, a machine calling its own
  // sibling app's public hostname can hit hairpin-NAT-style routing
  // limitations that have nothing to do with whether the actual security
  // control works (verified independently via a real external client at
  // the same moment: clean HTTP 403). This check is only fully meaningful
  // run from a genuinely external vantage point; a FAIL here only means
  // something when an actual response arrived with the wrong status.
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
    record(
      "SRS admin API is blocked on the public port",
      "skip",
      `request itself failed (${(err as Error).message}) — likely hairpin-NAT if run from inside Fly's private network; re-run from a genuinely external client to confirm`
    );
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
