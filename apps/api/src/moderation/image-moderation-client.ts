import { DetectModerationLabelsCommand, RekognitionClient } from "@aws-sdk/client-rekognition";
import { env } from "../common/env.js";

export interface ImageModerationResult {
  // Empty means nothing crossed the confidence threshold — not necessarily
  // "provably clean," just "nothing flagged."
  labels: { name: string; confidencePercent: number }[];
}

export interface ImageModerationClient {
  moderate(imageBytes: Buffer): Promise<ImageModerationResult>;
}

// IMPORTANT — read before wiring this into anything CSAM-adjacent:
// Rekognition's moderation labels (Explicit Nudity, Suggestive, Violence,
// Visually Disturbing, etc.) are a general content classifier, not a CSAM
// detector. It has no concept of subject age and makes no claim to. Real
// CSAM detection is hash-matching against a database of already-confirmed
// material (PhotoDNA, via an NCMEC partnership, or a vendor like Thorn
// Safer) — a legal/vendor relationship this codebase can't establish on
// its own. What this client IS good for: flagging likely nudity/violence/
// graphic content on public-facing images (stream thumbnails today) for a
// human moderator to review, same "never auto-delete, just queue for
// review" posture as scanText() in service.ts. If a human reviewer ever
// suspects actual CSAM in that queue, that's a distinct, urgent manual
// escalation — see docs/csam-escalation.md — not something this
// confidence score decides.
const MODERATION_CONFIDENCE_THRESHOLD = 75;

// Dev-only stub — used whenever AWS_REKOGNITION_ACCESS_KEY_ID is unset,
// same switch pattern as wallet/chapa-client.ts and common/object-storage.ts.
class StubImageModerationClient implements ImageModerationClient {
  async moderate(): Promise<ImageModerationResult> {
    return { labels: [] };
  }
}

class RealImageModerationClient implements ImageModerationClient {
  private client = new RekognitionClient({
    region: env.AWS_REKOGNITION_REGION,
    credentials: {
      accessKeyId: env.AWS_REKOGNITION_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_REKOGNITION_SECRET_ACCESS_KEY,
    },
  });

  async moderate(imageBytes: Buffer): Promise<ImageModerationResult> {
    const res = await this.client.send(
      new DetectModerationLabelsCommand({
        Image: { Bytes: imageBytes },
        MinConfidence: MODERATION_CONFIDENCE_THRESHOLD,
      })
    );
    const labels = (res.ModerationLabels ?? [])
      .filter((label) => label.Name && label.Confidence !== undefined)
      .map((label) => ({ name: label.Name!, confidencePercent: label.Confidence! }));
    return { labels };
  }
}

export const imageModerationClient: ImageModerationClient = env.AWS_REKOGNITION_ACCESS_KEY_ID
  ? new RealImageModerationClient()
  : new StubImageModerationClient();
