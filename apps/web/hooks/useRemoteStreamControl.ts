"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REMOTE_CONTROL_WS_URL } from "@/lib/config";
import { hashRemoteControlPassword } from "@/lib/remote-control/auth";
import {
  isEvent,
  isHello,
  isIdentified,
  isPreview,
  isResponse,
  type MessageToAssistant,
  type MessageToStreamer,
  type RemoteControlRequest,
  type RemoteControlResponse,
  type RemoteControlSettings,
  type RemoteControlStatusGeneral,
  type RemoteControlStatusTopLeft,
  type RemoteControlStatusTopRight,
} from "@/lib/remote-control/protocol";

// Real-time control channel for a creator's live broadcast, talking to
// apps/api/src/remote-control/relay.ts. Two separate credentials, not one:
// connect() first exchanges the caller's own Birq session for a scoped
// ticket (POST /api/backend/remote-control/ticket — this is what lets the
// relay know "this browser may control that specific creator", and what
// Phase 2.3's assistant-scope command allowlist is enforced against
// server-side). `password` below is a second, separate secret — the
// creator-chosen "remote control PIN" that completes the protocol's own
// hello/identify challenge-salt handshake, unchanged from
// Birq/RemoteControl/RemoteControl.swift. The ticket scopes/authenticates
// this browser to Birq; the password still authenticates this browser to
// the phone itself — see relay.ts's own comment for why both stay.
//
// Socket/timers/pending-request map live in refs, deliberately outside
// React state — same reasoning as ChatPanel.tsx's Centrifugo connection:
// they aren't serializable UI state, and a preview frame can arrive
// several times a second, so putting connection internals in state would
// cause far more re-renders than the socket itself produces messages worth
// rendering.

export type RemoteControlConnectionStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "connected"
  | "wrongPassword"
  | "forbidden"
  | "disconnected";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_LOG_ENTRIES = 200;

interface PendingRequest {
  resolve: (data: RemoteControlResponse | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RemoteStreamControlState {
  status: RemoteControlConnectionStatus;
  general: RemoteControlStatusGeneral | null;
  topLeft: RemoteControlStatusTopLeft | null;
  topRight: RemoteControlStatusTopRight | null;
  settings: RemoteControlSettings | null;
  currentSceneId: string | null;
  currentMicId: string | null;
  previewDataUrl: string | null;
  logs: string[];
}

export interface RemoteStreamControlActions {
  connect: (streamerId: string, password: string) => Promise<void>;
  disconnect: () => void;
  setLive: (on: boolean) => Promise<void>;
  setRecord: (on: boolean) => Promise<void>;
  setMute: (on: boolean) => Promise<void>;
  setTorch: (on: boolean) => Promise<void>;
  setZoom: (x: number) => Promise<void>;
  setScene: (id: string) => Promise<void>;
  setMic: (id: string) => Promise<void>;
  setBitratePreset: (id: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

export function useRemoteStreamControl(): RemoteStreamControlState & RemoteStreamControlActions {
  const [status, setStatus] = useState<RemoteControlConnectionStatus>("idle");
  const [general, setGeneral] = useState<RemoteControlStatusGeneral | null>(null);
  const [topLeft, setTopLeft] = useState<RemoteControlStatusTopLeft | null>(null);
  const [topRight, setTopRight] = useState<RemoteControlStatusTopRight | null>(null);
  const [settings, setSettings] = useState<RemoteControlSettings | null>(null);
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null);
  const [currentMicId, setCurrentMicId] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const passwordRef = useRef("");
  const streamerIdRef = useRef<string | null>(null);
  const nextRequestIdRef = useRef(1);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const pendingRef = useRef(new Map<number, PendingRequest>());

  const clearPending = useCallback((reason: string) => {
    for (const [, p] of pendingRef.current) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pendingRef.current.clear();
  }, []);

  const send = useCallback((msg: MessageToAssistant) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const request = useCallback((data: RemoteControlRequest): Promise<RemoteControlResponse | null> => {
    return new Promise((resolve, reject) => {
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected"));
        return;
      }
      const id = nextRequestIdRef.current++;
      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error("Request timed out"));
      }, REQUEST_TIMEOUT_MS);
      pendingRef.current.set(id, { resolve, reject, timer });
      // The assistant sends requests wrapped exactly as the streamer expects.
      socketRef.current.send(JSON.stringify({ request: { id, data } } satisfies MessageToStreamer));
    });
  }, []);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearPending("Disconnected");
    socketRef.current?.close();
    socketRef.current = null;
    passwordRef.current = "";
    reconnectAttemptsRef.current = 0;
    setStatus("idle");
    setGeneral(null);
    setTopLeft(null);
    setTopRight(null);
    setSettings(null);
    setCurrentSceneId(null);
    setCurrentMicId(null);
    setPreviewDataUrl(null);
    setLogs([]);
  }, [clearPending]);

  const refreshStatus = useCallback(async () => {
    await request({ getStatus: {} });
  }, [request]);

  const refreshSettings = useCallback(async () => {
    await request({ getSettings: {} });
  }, [request]);

  const handleMessage = useCallback(
    async (raw: string) => {
      let msg: MessageToStreamer & MessageToAssistant;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (isHello(msg)) {
        setStatus("authenticating");
        const { challenge, salt } = msg.hello.authentication;
        const authentication = await hashRemoteControlPassword(challenge, salt, passwordRef.current);
        send({ identify: { streamerId: streamerIdRef.current, authentication } });
        return;
      }

      if (isIdentified(msg)) {
        const result = msg.identified.result;
        if (result === "ok") {
          reconnectAttemptsRef.current = 0;
          setStatus("connected");
          void refreshSettings();
          void refreshStatus();
        } else {
          setStatus(result === "wrongPassword" ? "wrongPassword" : "disconnected");
          intentionalCloseRef.current = true; // don't retry a rejected password in a loop
          socketRef.current?.close();
        }
        return;
      }

      if (isResponse(msg)) {
        const { id, result, data } = msg.response;
        const pending = pendingRef.current.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRef.current.delete(id);
          if (result === "ok") pending.resolve(data);
          else pending.reject(new Error(result));
        }
        if (data && "getStatus" in data) {
          setGeneral(data.getStatus.general ?? null);
          setTopLeft(data.getStatus.topLeft ?? null);
          setTopRight(data.getStatus.topRight ?? null);
        }
        if (data && "getSettings" in data) {
          setSettings(data.getSettings.data);
        }
        return;
      }

      if (isEvent(msg)) {
        const ev = msg.event.data;
        if ("state" in ev) {
          if (ev.state.data.scene?.id) setCurrentSceneId(ev.state.data.scene.id);
          if (ev.state.data.mic?.id) setCurrentMicId(ev.state.data.mic.id);
        } else if ("log" in ev) {
          setLogs((prev) => [...prev, ev.log.entry].slice(-MAX_LOG_ENTRIES));
        }
        return;
      }

      if (isPreview(msg)) {
        setPreviewDataUrl(`data:image/jpeg;base64,${msg.preview.preview}`);
      }
    },
    [send, refreshSettings, refreshStatus]
  );

  const openSocket = useCallback(
    (url: string) => {
      const ws = new WebSocket(url);
      socketRef.current = ws;
      ws.onopen = () => setStatus("connecting");
      ws.onmessage = (e) => void handleMessage(e.data as string);
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        clearPending("Connection closed");
        if (intentionalCloseRef.current) {
          setStatus("disconnected");
          return;
        }
        setStatus("connecting");
        reconnectAttemptsRef.current += 1;
        // Exponential backoff with jitter — a flat retry across many tabs
        // would hammer the relay in lockstep after an outage.
        const base = Math.min(1000 * 2 ** reconnectAttemptsRef.current, MAX_BACKOFF_MS);
        const delay = base * (0.5 + Math.random() * 0.5);
        reconnectTimerRef.current = setTimeout(() => openSocket(url), delay);
      };
    },
    [handleMessage, clearPending]
  );

  const connect = useCallback(
    async (streamerId: string, password: string) => {
      disconnect();
      intentionalCloseRef.current = false;
      passwordRef.current = password;
      streamerIdRef.current = streamerId;
      setStatus("connecting");

      // Auth gateway first — no ticket, no socket.
      const res = await fetch("/api/backend/remote-control/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamerId }),
      });

      if (!res.ok) {
        setStatus(res.status === 403 ? "forbidden" : "disconnected");
        return;
      }

      // apps/api wraps every response as { success, data, error } — see
      // apps/web/app/api/backend/[...path]/route.ts, which passes this
      // through unmodified.
      const body = (await res.json()) as { data: { ticket: string; signature: string } };
      const { ticket, signature } = body.data;
      const url = `${REMOTE_CONTROL_WS_URL}?role=assistant&ticket=${encodeURIComponent(ticket)}&signature=${encodeURIComponent(signature)}`;
      openSocket(url);
    },
    [disconnect, openSocket]
  );

  useEffect(() => disconnect, [disconnect]);

  const setLive = useCallback(async (on: boolean) => void (await request({ setLive: { on } })), [request]);
  const setRecord = useCallback(async (on: boolean) => void (await request({ setRecord: { on } })), [request]);
  const setMute = useCallback(async (on: boolean) => void (await request({ setMute: { on } })), [request]);
  const setTorch = useCallback(async (on: boolean) => void (await request({ setTorch: { on } })), [request]);
  const setZoom = useCallback(async (x: number) => void (await request({ setZoom: { x } })), [request]);
  const setScene = useCallback(
    async (id: string) => {
      await request({ setScene: { id } });
      setCurrentSceneId(id); // optimistic; the state event confirms
    },
    [request]
  );
  const setMic = useCallback(
    async (id: string) => {
      await request({ setMic: { id } });
      setCurrentMicId(id);
    },
    [request]
  );
  const setBitratePreset = useCallback(
    async (id: string) => void (await request({ setBitratePreset: { id } })),
    [request]
  );

  return {
    status,
    general,
    topLeft,
    topRight,
    settings,
    currentSceneId,
    currentMicId,
    previewDataUrl,
    logs,
    connect,
    disconnect,
    setLive,
    setRecord,
    setMute,
    setTorch,
    setZoom,
    setScene,
    setMic,
    setBitratePreset,
    refreshStatus,
    refreshSettings,
  };
}
