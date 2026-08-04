import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";

// Same stub-vs-real switch every other optional-integration client in this
// codebase uses (see wallet/chapa-client.ts) — no real R2 bucket is
// provisioned yet, so this stays disabled until VOD_S3_* secrets are set.
// No public-URL requirement here (unlike the old version): playback now
// goes through getSignedVodUrl below, so the bucket never needs "Public
// Access" enabled at all.
export const isObjectStorageConfigured = Boolean(
  env.VOD_S3_ENDPOINT && env.VOD_S3_ACCESS_KEY_ID && env.VOD_S3_SECRET_ACCESS_KEY
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

// Returns the bucket key, not a URL — callers persist this key
// (stream_vods.playback_url) and turn it into a real URL per-request via
// getSignedVodUrl, never a stored permanent link. See BIRQ security
// guidelines Part III §5: a public VOD URL is directly hotlinkable/
// scrapable with no way to bound the resulting egress cost.
export async function uploadObject(key: string, body: Buffer, contentType: string): Promise<string> {
  if (!isObjectStorageConfigured) {
    throw new Error("Object storage is not configured (VOD_S3_* env vars unset)");
  }
  await getClient().send(
    new PutObjectCommand({ Bucket: env.VOD_S3_BUCKET, Key: key, Body: body, ContentType: contentType })
  );
  return key;
}

export async function deleteObject(key: string): Promise<void> {
  if (!isObjectStorageConfigured) return;
  await getClient().send(new DeleteObjectCommand({ Bucket: env.VOD_S3_BUCKET, Key: key }));
}

// Short-lived so a leaked/shared link stops working within hours, not
// forever — long enough to cover a normal viewing session given the
// frontend fetches this once per page load and holds it for the life of
// the page (no mid-playback refresh mechanism exists today, see
// apps/web/components/PastBroadcasts.tsx), short enough that scraping or
// hotlinking a captured URL has a hard expiry instead of working
// indefinitely like the old public-bucket URL did.
const VOD_URL_TTL_SECONDS = 6 * 60 * 60;

export async function getSignedVodUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.VOD_S3_BUCKET, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: VOD_URL_TTL_SECONDS });
}
