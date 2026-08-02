"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { closeAuthModal, useAuthModal } from "@/lib/useAuthModal";
import { LoginForm } from "./LoginForm";
import styles from "./AuthModal.module.css";
import { CloseIcon } from "./icons";

// E.3: real backend verification exists (auth/social-service.ts, verified
// against Google/Apple's actual public JWKS) — what's missing is a
// registered OAuth app on either side, so these buttons stay visibly
// present but inert rather than silently doing nothing. Checked at
// render time, not build time, so this flips on the moment real
// credentials are set with no code change.
const GOOGLE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
const APPLE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_APPLE_CLIENT_ID);

export function AuthModal() {
  const { open, initialMode } = useAuthModal();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  // Focus trap + return-focus-on-close, and Escape to dismiss — the
  // "standard modal" behaviors E.4 calls for explicitly.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAuthModal();
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleSuccess() {
    closeAuthModal();
    // Not a hard navigation — the whole point of the modal (E.4) is that
    // whatever gated action opened it (gift/subscribe/follow/chat) can
    // just resume where it was. router.refresh() re-runs the page's
    // Server Components so isAuthed-derived UI (nav, wallet, etc.)
    // catches up without losing client-side state a hard reload would.
    router.refresh();
  }

  return (
    <div className={styles.overlay} onClick={() => closeAuthModal()}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "Log in" : "Sign up"}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.closeButton} onClick={() => closeAuthModal()} aria-label="Close">
          <CloseIcon />
        </button>

        <div className={styles.formPanel}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={mode === "login" ? styles.tabActive : styles.tab}
              onClick={() => setMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              className={mode === "signup" ? styles.tabActive : styles.tab}
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </div>

          <LoginForm mode={mode} onSuccess={handleSuccess} hideCrossLink />

          <div className={styles.divider}>
            <span>or</span>
          </div>

          <div className={styles.socialButtons}>
            <button type="button" className={styles.socialButton} disabled={!GOOGLE_CONFIGURED} title={GOOGLE_CONFIGURED ? undefined : "Google sign-in isn't configured yet"}>
              Continue with Google
            </button>
            <button type="button" className={styles.socialButton} disabled={!APPLE_CONFIGURED} title={APPLE_CONFIGURED ? undefined : "Apple sign-in isn't configured yet"}>
              Continue with Apple
            </button>
          </div>
        </div>

        <div className={styles.heroPanel}>
          {/* Habesha character: art-blocked, not code-blocked — same
              status as the avatar system's placeholder parts (E.7). This
              is a CSS placeholder standing in for the real illustrator
              commission (one brief shared with E.7 — see that page). */}
          <div className={styles.heroPlaceholder} aria-hidden="true">
            <div className={styles.heroCircle} />
          </div>
          <p className={styles.heroTitle}>Live, straight from home.</p>
          <p className={styles.heroText}>
            Watch, chat, and support your favorite Ethiopian creators — or go live yourself.
          </p>
        </div>
      </div>
    </div>
  );
}
