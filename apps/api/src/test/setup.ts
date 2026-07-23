import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// vitest doesn't support --env-file passthrough the way tsx does, so load
// the repo-root .env manually. Tests need a real Postgres (docker compose)
// since mocking SQL would test nothing meaningful about ledger correctness.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const envPath = path.join(rootDir, ".env");

try {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // .env not present; rely on environment variables already set.
}
