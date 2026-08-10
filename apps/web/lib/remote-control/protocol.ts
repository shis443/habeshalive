/**
 * Birq Remote Control — wire protocol types.
 *
 * These mirror the Swift enums in `Birq/RemoteControl/RemoteControl.swift` exactly.
 * Swift encodes enums with associated values as `{ "caseName": { ...payload } }`,
 * so every message type here is a single-key object. Do not "tidy" this into a
 * discriminated union with a `type` field — it would stop matching the wire format
 * and silently break every command.
 *
 * Source of truth is the Swift file. If the protocol changes there, change it here.
 */

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface RemoteControlAuthentication {
  challenge: string;
  salt: string;
}

export type RemoteControlResult =
  | 'ok'
  | 'wrongPassword'
  | 'unknownRequest'
  | 'notIdentified'
  | 'alreadyIdentified'
  | 'error';

// ─── Requests (assistant → streamer) ─────────────────────────────────────────

export type RemoteControlRequest =
  | { getStatus: Record<string, never> }
  | { getSettings: Record<string, never> }
  | { setLive: { on: boolean } }
  | { setRecord: { on: boolean } }
  | { setStream: { on: boolean } }
  | { setMute: { on: boolean } }
  | { setMic: { id: string } }
  | { setTorch: { on: boolean } }
  | { setZoom: { x: number } }
  | { setZoomPreset: { id: string } }
  | { setScene: { id: string } }
  | { setBitratePreset: { id: string } }
  | { setDebugLogging: { on: boolean } }
  | { setStealthMode: { on: boolean } }
  | { setPreviewStream: { on: boolean } }
  | { setSrtConnectionPrioritiesEnabled: { enabled: boolean } }
  | { setSrtConnectionPriority: { id: string; priority: number; enabled: boolean } }
  | { setAutoSceneSwitcher: { id: string | null } }
  | { triggerReaction: { id: string } }
  | { moveToGimbalPreset: { id: string } }
  | { chatMessages: { messages: RemoteControlChatMessage[] } };

export interface RemoteControlChatMessage {
  id: number;
  user: string;
  userColor?: string;
  segments: { text?: string; url?: string }[];
  timestamp: string;
}

// ─── Responses & events (streamer → assistant) ───────────────────────────────

export interface RemoteControlStatusGeneral {
  batteryLevel?: number;
  flame?: string;
  wiFiSsid?: string;
  isLive?: boolean;
  isRecording?: boolean;
  isMuted?: boolean;
}

export interface RemoteControlStatusTopLeft {
  stream?: { message: string; ok: boolean };
  camera?: { message: string; ok: boolean };
  mic?: { message: string; ok: boolean };
  zoom?: { message: string; ok: boolean };
  obs?: { message: string; ok: boolean };
  events?: { message: string; ok: boolean };
  chat?: { message: string; ok: boolean };
  viewers?: { message: string; ok: boolean };
}

export interface RemoteControlStatusTopRight {
  audioLevel?: { message: string; ok: boolean };
  rtmpServer?: { message: string; ok: boolean };
  remoteControl?: { message: string; ok: boolean };
  gameController?: { message: string; ok: boolean };
  bitrate?: { message: string; ok: boolean };
  uptime?: { message: string; ok: boolean };
  location?: { message: string; ok: boolean };
  srtla?: { message: string; ok: boolean };
  recording?: { message: string; ok: boolean };
  browserWidgets?: { message: string; ok: boolean };
}

export interface RemoteControlSettingsScene {
  id: string;
  name: string;
}

export interface RemoteControlSettingsBitratePreset {
  id: string;
  bitrate: number;
}

export interface RemoteControlSettingsMic {
  id: string;
  name: string;
}

export interface RemoteControlSettings {
  scenes: RemoteControlSettingsScene[];
  bitratePresets: RemoteControlSettingsBitratePreset[];
  mics: RemoteControlSettingsMic[];
  srtConnectionPriorities?: {
    enabled: boolean;
    priorities: { id: string; name: string; priority: number; enabled: boolean }[];
  };
}

export type RemoteControlResponse =
  | {
      getStatus: {
        general?: RemoteControlStatusGeneral;
        topLeft?: RemoteControlStatusTopLeft;
        topRight?: RemoteControlStatusTopRight;
      };
    }
  | { getSettings: { data: RemoteControlSettings } };

export type RemoteControlEvent =
  | { state: { data: { scene?: RemoteControlSettingsScene; mic?: RemoteControlSettingsMic } } }
  | { log: { entry: string } }
  | { mediaShareSegmentReceived: { id: string } };

// ─── Envelopes ───────────────────────────────────────────────────────────────

export type MessageToStreamer =
  | { hello: { apiVersion: string; authentication: RemoteControlAuthentication } }
  | { identified: { result: RemoteControlResult } }
  | { request: { id: number; data: RemoteControlRequest } }
  | { pong: Record<string, never> };

export type MessageToAssistant =
  | { identify: { streamerId: string | null; authentication: string } }
  | {
      response: {
        id: number;
        result: RemoteControlResult;
        data: RemoteControlResponse | null;
      };
    }
  | { event: { data: RemoteControlEvent } }
  | { preview: { preview: string } } // base64-encoded JPEG
  | { ping: Record<string, never> };

// ─── Narrowing helpers ───────────────────────────────────────────────────────
// Swift's single-key encoding means `'hello' in msg` is the correct discriminant.

export function isHello(
  msg: MessageToStreamer,
): msg is Extract<MessageToStreamer, { hello: unknown }> {
  return 'hello' in msg;
}

export function isIdentified(
  msg: MessageToStreamer,
): msg is Extract<MessageToStreamer, { identified: unknown }> {
  return 'identified' in msg;
}

export function isRequest(
  msg: MessageToStreamer,
): msg is Extract<MessageToStreamer, { request: unknown }> {
  return 'request' in msg;
}

export function isResponse(
  msg: MessageToAssistant,
): msg is Extract<MessageToAssistant, { response: unknown }> {
  return 'response' in msg;
}

export function isEvent(
  msg: MessageToAssistant,
): msg is Extract<MessageToAssistant, { event: unknown }> {
  return 'event' in msg;
}

export function isPreview(
  msg: MessageToAssistant,
): msg is Extract<MessageToAssistant, { preview: unknown }> {
  return 'preview' in msg;
}
