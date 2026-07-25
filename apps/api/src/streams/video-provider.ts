import { randomBytes } from "node:crypto";
import { env } from "../common/env.js";

export interface VideoProvider {
  createLiveInput(): Promise<{ streamKey: string }>;
  getRtmpUrl(): string;
  getPlaybackUrl(streamKey: string): string;
}

// Self-hosted SRS (see infra/srs/). Unlike a managed provider, SRS needs no
// provisioning API call to accept a new stream — any RTMP stream name works,
// so "creating a live input" is just generating a random key locally. The
// RTMP/HLS hosts are env-driven since they differ between local dev and
// production (see infra/srs/README.md for port/URL conventions).
class SrsVideoProvider implements VideoProvider {
  async createLiveInput(): Promise<{ streamKey: string }> {
    return { streamKey: randomBytes(16).toString("hex") };
  }

  getRtmpUrl(): string {
    return `rtmp://${env.SRS_RTMP_HOST}/live`;
  }

  getPlaybackUrl(streamKey: string): string {
    return `${env.SRS_HTTP_SCHEME}://${env.SRS_HTTP_HOST}/live/${streamKey}.m3u8`;
  }
}

export const videoProvider: VideoProvider = new SrsVideoProvider();
