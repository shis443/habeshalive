"use client";

import { useSyncExternalStore } from "react";

// Same external-store reasoning as useLanguage.ts: many independent
// components (TopNav's nav buttons, ChatPanel's Gursha/send, FollowButton,
// TierActionDropdown) all need to trigger the SAME modal instance (mounted
// once at the root layout — see components/AuthModalRoot.tsx), not a
// per-component useState each would have no way to reach.
interface AuthModalState {
  open: boolean;
  initialMode: "login" | "signup";
}

let state: AuthModalState = { open: false, initialMode: "login" };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return state;
}

// A stable module-level constant, not a fresh object literal per call —
// useSyncExternalStore requires getServerSnapshot to return a referentially
// stable value when nothing changed, or React treats every render as a
// change (real bug, caught live: "The result of getServerSnapshot should
// be cached to avoid an infinite loop").
const SERVER_SNAPSHOT: AuthModalState = { open: false, initialMode: "login" };
function getServerSnapshot(): AuthModalState {
  return SERVER_SNAPSHOT;
}

export function openAuthModal(mode: "login" | "signup" = "login") {
  state = { open: true, initialMode: mode };
  emit();
}

export function closeAuthModal() {
  state = { ...state, open: false };
  emit();
}

export function useAuthModal() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
