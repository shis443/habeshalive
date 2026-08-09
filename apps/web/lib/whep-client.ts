import { whepBrokerResponseSchema } from "@birq/shared";

// Native RTCPeerConnection WHEP (WebRTC-HTTP Egress Protocol) client —
// talks to apps/api's broker (streams/whep-routes.ts) at
// /api/backend/streams/:id/whep, not directly to SRS. Unlike
// GoLivePanel.tsx's WHIP publish flow (a direct browser-to-SRS POST, see
// SRS_WHIP_URL in ./config), WHEP playback is authenticated/rate-limited/
// ban-checked server-side, so it has to go through apps/web's own
// same-origin proxy — which means the request/response bodies are JSON,
// not raw SDP (see that proxy's own comment, and
// packages/shared/src/schemas/streams.ts's whepBrokerRequestSchema for
// why).

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    // Same 3s bound as GoLivePanel.tsx's identical helper — don't wait
    // forever for a straggler candidate before sending the offer.
    setTimeout(resolve, 3000);
  });
}

export interface WhepConnection {
  pc: RTCPeerConnection;
  sessionId: string;
  // Tears down both sides: closes the local RTCPeerConnection immediately
  // (synchronous, always happens) and best-effort notifies apps/api so it
  // can free the concurrency-ceiling slot and issue the real SRS-side
  // teardown (whep-routes.ts's DELETE route) — not fatal if this part
  // fails (a closed tab that never got to call this at all relies on the
  // same registry TTL backstop, see whep-session-registry.ts).
  close(): Promise<void>;
}

// Thrown for any failure before/during the broker exchange (network,
// non-2xx, malformed answer) — the caller (VideoPlayer.tsx's state
// machine) treats this identically to the hard connect-timeout: fall back
// to HLS, don't retry WHEP itself.
export class WhepConnectError extends Error {}

export async function connectWhep(streamId: string, videoEl: HTMLVideoElement): Promise<WhepConnection> {
  const pc = new RTCPeerConnection();
  // recvonly: this is playback, never publish — matching WHEP's own
  // one-directional semantics (WHIP is the publish half, already used
  // elsewhere in this app for the opposite direction).
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream && videoEl.srcObject !== remoteStream) {
      videoEl.srcObject = remoteStream;
    }
  };

  let offer: RTCSessionDescriptionInit;
  try {
    offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);
  } catch (err) {
    pc.close();
    throw new WhepConnectError(err instanceof Error ? err.message : "Failed to create WebRTC offer");
  }

  const localSdp = pc.localDescription?.sdp;
  if (!localSdp) {
    pc.close();
    throw new WhepConnectError("No local SDP after ICE gathering");
  }

  let res: Response;
  try {
    res = await fetch(`/api/backend/streams/${streamId}/whep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerSdp: localSdp }),
    });
  } catch (err) {
    pc.close();
    throw new WhepConnectError(err instanceof Error ? err.message : "WHEP broker request failed");
  }

  if (!res.ok) {
    pc.close();
    throw new WhepConnectError(`WHEP broker rejected offer (HTTP ${res.status})`);
  }

  let data: ReturnType<typeof whepBrokerResponseSchema.parse>;
  try {
    data = whepBrokerResponseSchema.parse(await res.json());
    await pc.setRemoteDescription({ type: "answer", sdp: data.answerSdp });
  } catch (err) {
    pc.close();
    throw new WhepConnectError(err instanceof Error ? err.message : "Invalid WHEP answer");
  }

  return {
    pc,
    sessionId: data.sessionId,
    async close() {
      pc.close();
      try {
        await fetch(`/api/backend/streams/${streamId}/whep`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: data.sessionId }),
        });
      } catch {
        // Best-effort — see this function's own doc comment above.
      }
    },
  };
}
