"use client";

import { formatSantimAsBirr, type GifterBadge, type GiftType } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDropdown } from "@/lib/useDropdown";
import { CloseIcon } from "./icons";
import styles from "./GurshaModal.module.css";

// Real illustrated mulmul-bread art isn't available yet (same art-blocked,
// not code-blocked, situation as the avatar system) — these are CSS-styled
// placeholders keyed off gift_types.animation_key, swappable for real
// assets later without touching the data model.
const THEME_STYLE: Record<string, { emoji: string; color: string }> = {
  mulmul_classic: { emoji: "🍞", color: "#a67c52" },
  mulmul_gold: { emoji: "🍞", color: "#d4af37" },
  mulmul_berbere: { emoji: "🍞", color: "#c1440e" },
  mulmul_holiday: { emoji: "🍞", color: "#2f7d4f" },
};

const QUANTITY_TIERS = [1, 5, 10, 25, 50];
const MAX_QUANTITY = 100;

const TIER_LABEL: Record<GifterBadge["tier"], string> = {
  none: "No badge yet",
  bronze: "Bronze gifter",
  silver: "Silver gifter",
  gold: "Gold gifter",
  platinum: "Platinum gifter",
};

export function GurshaModal({
  streamId,
  creatorId,
  giftTypes,
  isAuthed,
  recentChatters,
  onClose,
}: {
  streamId: string;
  creatorId: string;
  giftTypes: GiftType[];
  isAuthed: boolean;
  recentChatters: { userId: string; username: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(giftTypes[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [customQuantity, setCustomQuantity] = useState("");
  const [targeted, setTargeted] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [message, setMessage] = useState("");
  const [badge, setBadge] = useState<GifterBadge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const dropdown = useDropdown<HTMLDivElement>();
  const { setOpen } = dropdown;
  useEffect(() => {
    setOpen(true);
  }, [setOpen]);
  useEffect(() => {
    if (!dropdown.open) onClose();
  }, [dropdown.open, onClose]);

  useEffect(() => {
    if (!isAuthed) return;
    fetch(`/api/backend/wallet/gifter-badge/${creatorId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setBadge(data))
      .catch(() => {
        // Non-critical — the progress bar just doesn't render without it.
      });
  }, [creatorId, isAuthed]);

  async function handleSend() {
    if (!isAuthed) {
      router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!selectedThemeId) return;
    if (targeted && !recipientId) {
      setError("Pick a viewer to Gursha, or switch back to Community.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/wallet/gifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamId,
          giftTypeId: selectedThemeId,
          quantity,
          message: message.trim() || undefined,
          recipientId: targeted ? recipientId : undefined,
          isAnonymous,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send Gursha");
      setBadge(data.badge);
      setSuccess(true);
      router.refresh();
      setTimeout(onClose, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function goToSubscribe() {
    onClose();
    const target = document.querySelector<HTMLButtonElement>("#subscribe-action button");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.click();
  }

  const selectedTheme = giftTypes.find((g) => g.id === selectedThemeId);
  const totalSantim = selectedTheme ? selectedTheme.priceSantim * quantity : 0;

  const progressPercent =
    badge && badge.nextTierThresholdSantim
      ? Math.min(100, (badge.totalGurshaSantim / badge.nextTierThresholdSantim) * 100)
      : 100;

  return (
    <div className={styles.anchor} ref={dropdown.ref}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3 className={styles.title}>Send Gursha</h3>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {badge && (
          <div className={styles.badgeBlock}>
            <div className={styles.badgeRow}>
              <span>{TIER_LABEL[badge.tier]}</span>
              {badge.nextTierThresholdSantim && (
                <span className={styles.badgeMeta}>
                  {formatSantimAsBirr(badge.totalGurshaSantim)} / {formatSantimAsBirr(badge.nextTierThresholdSantim)}
                </span>
              )}
            </div>
            {badge.nextTierThresholdSantim && (
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
              </div>
            )}
          </div>
        )}

        <div className={styles.modeRow}>
          <button
            type="button"
            className={!targeted ? styles.modeButtonActive : styles.modeButton}
            onClick={() => setTargeted(false)}
          >
            Gursha to the Community
          </button>
          <button
            type="button"
            className={targeted ? styles.modeButtonActive : styles.modeButton}
            onClick={() => setTargeted(true)}
            disabled={recentChatters.length === 0}
          >
            Gursha a specific viewer
          </button>
        </div>

        {targeted && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="gursha-recipient">
              Viewer
            </label>
            <select
              id="gursha-recipient"
              className={styles.input}
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
            >
              <option value="">Choose a viewer from chat...</option>
              {recentChatters.map((c) => (
                <option key={c.userId} value={c.userId}>
                  @{c.username}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
          Send Anonymously
        </label>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Theme Your Gursha</label>
          <div className={styles.grid}>
            {giftTypes.map((theme) => {
              const style = THEME_STYLE[theme.animationKey] ?? { emoji: "🎁", color: "#8B5E34" };
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`${styles.themeTile} ${selectedThemeId === theme.id ? styles.themeTileSelected : ""}`}
                  style={{ borderColor: selectedThemeId === theme.id ? style.color : undefined }}
                  onClick={() => setSelectedThemeId(theme.id)}
                >
                  <span className={styles.themeEmoji} style={{ backgroundColor: `${style.color}33` }}>
                    {style.emoji}
                  </span>
                  <span className={styles.giftName}>{theme.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Quantity</label>
          <div className={styles.tierRow}>
            {QUANTITY_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                className={quantity === tier && !customQuantity ? styles.tierButtonActive : styles.tierButton}
                onClick={() => {
                  setQuantity(tier);
                  setCustomQuantity("");
                }}
              >
                {tier}
              </button>
            ))}
          </div>
          <input
            type="number"
            min="1"
            max={MAX_QUANTITY}
            className={styles.input}
            placeholder={`Custom quantity (max ${MAX_QUANTITY})`}
            value={customQuantity}
            onChange={(e) => {
              const raw = e.target.value;
              setCustomQuantity(raw);
              const n = Math.min(MAX_QUANTITY, Math.max(1, Number(raw) || 1));
              setQuantity(n);
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="gursha-message">
            Message (optional)
          </label>
          <input
            id="gursha-message"
            type="text"
            maxLength={200}
            className={styles.input}
            placeholder="Say something..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        <p className={styles.total}>Total: {formatSantimAsBirr(totalSantim)}</p>

        {error && <p className={styles.error}>{error}</p>}
        {success && <p className={styles.success}>Gursha sent!</p>}

        <button
          type="button"
          className={styles.sendButton}
          onClick={handleSend}
          disabled={loading || !selectedThemeId}
        >
          {loading ? "Sending..." : "Send Gursha"}
        </button>

        <button type="button" className={styles.backToSubscribe} onClick={goToSubscribe}>
          Looking to subscribe instead? →
        </button>
      </div>
    </div>
  );
}
