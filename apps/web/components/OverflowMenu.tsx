"use client";

import { useState } from "react";
import { useDropdown } from "@/lib/useDropdown";
import { openAuthModal } from "@/lib/useAuthModal";
import { SHARE_TARGETS } from "@/lib/shareTargets";
import { ReportModal } from "./ReportModal";
import styles from "./ShareSheet.module.css";
import { BlockedIcon, EyeOffIcon, FlagIcon, MoreIcon, ShareIcon } from "./icons";

// D.1's three-dot overflow menu / D.4's report entry points, extended for
// the Explore card with Share / Not Interested / Block. shareUrl/shareText
// are explicit props (not read from window.location like ShareSheet.tsx)
// because a card's menu shares the SPECIFIC stream it's attached to, not
// whatever page the card happens to be rendered on.
export function OverflowMenu({
  streamId,
  creatorId,
  shareUrl,
  shareText,
  isAuthed,
  onDismissed,
}: {
  streamId: string;
  creatorId: string;
  // Omit both on the watch page (ActionRow.tsx already has its own
  // dedicated ShareSheet next to this menu) — the Share entry only
  // appears when both are provided, which is what the Explore card needs
  // (a card has no room for a second, separate share button).
  shareUrl?: string;
  shareText?: string;
  isAuthed: boolean;
  // Called after a successful Not Interested / Block so the card can
  // remove itself from the grid immediately, without a full reload.
  onDismissed?: () => void;
}) {
  const dropdown = useDropdown<HTMLDivElement>();
  const [reportTarget, setReportTarget] = useState<"stream" | "user" | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [pending, setPending] = useState<"notInterested" | "block" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openReport(target: "stream" | "user") {
    dropdown.setOpen(false);
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setReportTarget(target);
  }

  function requireAuth(): boolean {
    if (!isAuthed) {
      dropdown.setOpen(false);
      openAuthModal();
      return false;
    }
    return true;
  }

  async function handleNotInterested() {
    if (!requireAuth()) return;
    setPending("notInterested");
    setError(null);
    try {
      const res = await fetch(`/api/backend/streams/${creatorId}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to update");
      dropdown.setOpen(false);
      onDismissed?.();
    } catch {
      setError("Something went wrong");
    } finally {
      setPending(null);
    }
  }

  async function handleBlock() {
    if (!requireAuth()) return;
    setPending("block");
    setError(null);
    try {
      const res = await fetch(`/api/backend/blocks/creators/${creatorId}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to block");
      dropdown.setOpen(false);
      onDismissed?.();
    } catch {
      setError("Something went wrong");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={styles.wrap} ref={dropdown.ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-label="More options"
        onClick={() => {
          setShowShare(false);
          dropdown.setOpen((o) => !o);
        }}
      >
        <MoreIcon />
      </button>
      {dropdown.open && (
        <div className={styles.menu}>
          {!showShare ? (
            <>
              {shareUrl && shareText && (
                <button type="button" className={styles.menuItem} onClick={() => setShowShare(true)}>
                  <ShareIcon /> Share
                </button>
              )}
              <button type="button" className={styles.menuItem} disabled={pending === "notInterested"} onClick={handleNotInterested}>
                <EyeOffIcon /> {pending === "notInterested" ? "Working…" : "Not Interested"}
              </button>
              <button type="button" className={styles.menuItem} disabled={pending === "block"} onClick={handleBlock}>
                <BlockedIcon /> {pending === "block" ? "Working…" : "Block"}
              </button>
              <button type="button" className={styles.menuItem} onClick={() => openReport("stream")}>
                <FlagIcon /> Report Live Stream
              </button>
              <button type="button" className={styles.menuItem} onClick={() => openReport("user")}>
                <FlagIcon /> Report Something Else
              </button>
            </>
          ) : (
            <>
              {SHARE_TARGETS.map((target) => (
                <a
                  key={target.label}
                  href={target.href(shareUrl!, shareText!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.menuItem}
                >
                  {target.label}
                </a>
              ))}
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => navigator.clipboard.writeText(shareUrl!)}
              >
                Copy URL
              </button>
              <button type="button" className={styles.menuItem} onClick={() => setShowShare(false)}>
                ← Back
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {reportTarget === "stream" && (
        <ReportModal
          targetType="stream"
          targetId={streamId}
          title="Report this live stream"
          onClose={() => setReportTarget(null)}
        />
      )}
      {reportTarget === "user" && (
        <ReportModal
          targetType="user"
          targetId={creatorId}
          title="Report something else"
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}
