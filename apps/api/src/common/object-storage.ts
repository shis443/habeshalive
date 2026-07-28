import { PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env.js";

// Same stub-vs-real switch every other optional-integration client in this
// codebase uses (see wallet/chapa-client.ts) — no real R2 bucket is
// provisioned yet, so this stays disabled until VOD_S3_* secrets are set.
export const isObjectStorageConfigured = Boolean(
  env.VOD_S3_ENDPOINT && env.VOD_S3_ACCESS_KEY_ID && env.VOD_S3_SECRET_ACCESS_KEY && env.VOD_S3_PUBLIC_URL
);

let client: S3Client | null = null;
function getClient(): S3Client {
  client ??= new S3Client({
    endpoint: env.VOD_S3_ENDPOINT,
    region: "auto", // R2 ignores region but the SDK requires a value
    credentials: { accessKeyId: env.VOD_S3_ACCESS_KEY_ID, secretAccessKey: env.VOD_S3_SECRET_ACCESS_KEY },
  });
  return client;
}

export async function uploadObject(key: string, body: Buffer, contentType: string): Promise<string> {
  if (!isObjectStorageConfigured) {
    throw new Error("Object storage is not configured (VOD_S3_* env vars unset)");
  }
  await getClient().send(
    new PutObjectCommand({ Bucket: env.VOD_S3_BUCKET, Key: key, Body: body, ContentType: contentType })
  );
  return `${env.VOD_S3_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
}

export async function deleteObject(key: string): Promise<void> {
  if (!isObjectStorageConfigured) return;
  await getClient().send(new DeleteObjectCommand({ Bucket: env.VOD_S3_BUCKET, Key: key }));
}

// Reverses uploadObject's URL construction — stream_vods stores the full
// public URL, but deleting needs just the bucket key.
export function objectKeyFromPublicUrl(url: string): string | null {
  const prefix = `${env.VOD_S3_PUBLIC_URL.replace(/\/$/, "")}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}
