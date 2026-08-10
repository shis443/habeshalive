/**
 * Birq Remote Control — authentication handshake.
 *
 * Replicates `remoteControlHashPassword` from Birq/RemoteControl/RemoteControl.swift:
 *
 *   concatenated = password + salt
 *   hash         = SHA256(concatenated)
 *   concatenated = base64(hash) + challenge
 *   result       = base64(SHA256(concatenated))
 *
 * This must match byte-for-byte or the streamer replies `wrongPassword` and closes.
 * The double-hash-with-base64-in-between is deliberate on the Swift side — do not
 * "simplify" it to a single hash.
 *
 * Uses Web Crypto (available in browsers and Node 18+), so this file works in both
 * the client component and the server-side auth gateway.
 */

function toBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  if (typeof window === 'undefined') {
    return Buffer.from(arr).toString('base64');
  }
  let binary = '';
  for (const b of arr) binary += String.fromCharCode(b);
  return window.btoa(binary);
}

async function sha256(input: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest('SHA-256', data);
}

/**
 * Produce the authentication string sent in the `identify` message.
 */
export async function hashRemoteControlPassword(
  challenge: string,
  salt: string,
  password: string,
): Promise<string> {
  const first = await sha256(`${password}${salt}`);
  const second = await sha256(`${toBase64(first)}${challenge}`);
  return toBase64(second);
}
