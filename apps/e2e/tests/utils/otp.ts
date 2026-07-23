import { execSync } from "node:child_process";

// The dev SMS gateway (apps/api/src/auth/sms-gateway.ts) only
// console.logs OTP codes — there's no dev-bypass endpoint in the app
// itself (deliberately: not adding an auth backdoor just for tests).
// Reading it back from `docker logs` is real E2E test infrastructure
// exercising the actual dev flow, not a workaround — it's exactly what a
// developer testing this locally would do by hand.
const API_CONTAINER = process.env.API_CONTAINER ?? "habeshalive-api-1";

export async function getLatestOtpForPhone(phoneNumber: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const pattern = new RegExp(`\\[dev sms\\] OTP for ${phoneNumber.replace(/\+/g, "\\+")}: (\\d{6})`);

  while (Date.now() < deadline) {
    const logs = execSync(`docker logs ${API_CONTAINER} --since 2m 2>&1`, { encoding: "utf8" });
    const matches = [...logs.matchAll(new RegExp(pattern, "g"))];
    if (matches.length > 0) return matches[matches.length - 1]![1]!;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No OTP found in ${API_CONTAINER} logs for ${phoneNumber} within ${timeoutMs}ms`);
}
