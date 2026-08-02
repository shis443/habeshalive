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

function getServerSnapshot(): AuthModalState {
  return { open: false, initialMode: "login" };
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
