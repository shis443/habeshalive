"use client";

import {
  formatSantimAsBirr,
  PLATFORM_SUBSCRIPTION_MIN_SANTIM,
  type GifterBadge,
  type GiftTier,
  type PlatformSubscription,
  type Rank,
  type UserRank,
} from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { openAuthModal } from "@/lib/useAuthModal";
import { CloseIcon } from "./icons";
import styles from "./GurshaModal.module.css";

// Real illustrated mulmul-bread/buna/tej art isn't available yet (same
// art-blocked, not code-blocked, situation as the avatar system) — these
// are CSS-styled placeholders keyed off gift_types.animation_key,
// swappable for real assets later without touching the data model.
const THEME_STYLE: Record<string, { emoji: string; color: string }> = {
  mulmul_classic: { emoji: "🍞", color: "#a67c52" },
  buna_jebena: { emoji: "☕", color: "#6f4518" },
  buna_sini: { emoji: "☕", color: "#8B5E34" },
  buna_macchiato: { emoji: "☕", color: "#c49a6c" },
  tej_berele: { emoji: "🍯", color: "#d4af37" },
  tej_filtered: { emoji: "🍯", color: "#e8c766" },
  kurt_special: { emoji: "🔥", color: "#c1440e" },
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

// Named after historical Ethiopian military/administrative titles — see
// db/migrations/0025_gursha_gift_economy.sql for the design rationale.
const RANK_LABEL: Record<Rank, string> = {
  newari: "Newari",
  asir_aleka: "Asir Aleka",
  meto_aleka: "Meto Aleka",
  shi_aleka: "Shi Aleka",
  dejazmach: "Dejazmach",
};

// Preset points along the sliding scale — the spec's "150 ETB minimum,
// scaling up to 5,000+ ETB" isn't a fixed ladder like subscription_tiers,
// so these are just convenient jump-to buttons; the input below them
// accepts any value at or above the floor.
const SUB_AMOUNT_PRESETS_SANTIM = [15000, 30000, 100000, 300000, 500000];

export function GurshaModal({
  streamId,
  creatorId,
  giftTiers,
  isAuthed,
  recentChatters,
  onClose,
}: {
  streamId: string;
  creatorId: string;
  giftTiers: GiftTier[];
  isAuthed: boolean;
  recentChatters: { userId: string; username: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedTierKey, setSelectedTierKey] = useState<GiftTier["key"] | null>(giftTiers[0]?.key ?? null);
  const selectedTier = giftTiers.find((t) => t.key === selectedTierKey) ?? giftTiers[0] ?? null;
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(giftTiers[0]?.giftTypes[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [customQuantity, setCustomQuantity] = useState("");
  const [targeted, setTargeted] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [message, setMessage] = useState("");
  const [badge, setBadge] = useState<GifterBadge | null>(null);
  const [rank, setRank] = useState<UserRank | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [subExpanded, setSubExpanded] = useState(false);
  const [platformSub, setPlatformSub] = useState<PlatformSubscription | null>(null);
  const [subAmount, setSubAmount] = useState(PLATFORM_SUBSCRIPTION_MIN_SANTIM);
  const [subCustomAmount, setSubCustomAmount] = useState("");
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [subSuccess, setSubSuccess] = useState(false);

  // This modal is already mount/unmount-controlled by the parent
  // (ChatPanel's gurshaModalOpen state) — it doesn't need useDropdown's
  // internal open/close state machine, just the outside-click part.
  // A prior version borrowed useDropdown wholesale: it starts `open: false`,
  // and `setOpen(true)` doesn't take effect until the next render — so the
  // very next effect, reading the same stale `open === false`, called
  // onClose() immediately in the same effect flush. Net effect: the modal
  // mounted and unmounted itself before a viewer could ever see it ("won't
  // show for more than a blink"). This version has no internal open state
  // to race — an outside click just calls onClose() directly.
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  useEffect(() => {
    if (!isAuthed) return;
    fetch(`/api/backend/wallet/gifter-badge/${creatorId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setBadge(data))
      .catch(() => {
        // Non-critical — the progress bar just doesn't render without it.
      });
    // Platform-wide, unlike the per-creator badge above — same endpoint
    // regardless of which creator's stream this modal was opened from.
    fetch(`/api/backend/wallet/rank`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setRank(data))
      .catch(() => {
        // Non-critical — the rank block just doesn't render without it.
      });
    fetch(`/api/backend/subscriptions/platform/mine`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setPlatformSub(data))
      .catch(() => {
        // Non-critical — defaults to "not subscribed" UI.
      });
  }, [creatorId, isAuthed]);

  async function handleSend() {
    if (!isAuthed) {
      openAuthModal();
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
      setRank(data.rank);
      setSuccess(true);
      router.refresh();
      setTimeout(onClose, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribeToPlatform() {
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setSubLoading(true);
    setSubError(null);
    try {
      const res = await fetch("/api/backend/subscriptions/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountSantim: subAmount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start subscription");
      setPlatformSub(data);
      setSubSuccess(true);
      router.refresh();
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubLoading(false);
    }
  }

  function goToSubscribe() {
    onClose();
    const target = document.querySelector<HTMLButtonElement>("#subscribe-action button");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.click();
  }

  const selectedTheme = selectedTier?.giftTypes.find((g) => g.id === selectedThemeId);
  const totalSantim = selectedTheme ? selectedTheme.priceSantim * quantity : 0;

  const badgeProgressPercent =
    badge && badge.nextTierThresholdSantim
      ? Math.min(100, (badge.totalGurshaSantim / badge.nextTierThresholdSantim) * 100)
      : 100;
  const rankProgressPercent =
    rank && rank.nextRankThresholdSantim
      ? Math.min(100, (rank.totalGiftSpendSantim / rank.nextRankThresholdSantim) * 100)
      : 100;

  return (
    <div className={styles.anchor} ref={anchorRef}>
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
                <div className={styles.progressFill} style={{ width: `${badgeProgressPercent}%` }} />
              </div>
            )}
          </div>
        )}

        {rank && (
          <div className={styles.badgeBlock}>
            <div className={styles.badgeRow}>
              <span>Rank: {RANK_LABEL[rank.rank]}</span>
              {rank.nextRankThresholdSantim && (
                <span className={styles.badgeMeta}>
                  {formatSantimAsBirr(rank.totalGiftSpendSantim)} / {formatSantimAsBirr(rank.nextRankThresholdSantim)}
                </span>
              )}
            </div>
            {rank.nextRankThresholdSantim && (
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${rankProgressPercent}%` }} />
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
          <label className={styles.fieldLabel}>Gift Tier</label>
          <div className={styles.tierRow}>
            {giftTiers.map((tier) => (
              <button
                key={tier.key}
                type="button"
                className={selectedTierKey === tier.key ? styles.tierButtonActive : styles.tierButton}
                onClick={() => {
                  setSelectedTierKey(tier.key);
                  setSelectedThemeId(tier.giftTypes[0]?.id ?? null);
                }}
              >
                {tier.displayName}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>
            Theme{selectedTier ? ` (${formatSantimAsBirr(selectedTier.basePriceSantim)} each)` : ""}
          </label>
          <div className={styles.grid}>
            {(selectedTier?.giftTypes ?? []).map((theme) => {
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

        {/* Separate from the gift send above — adjusting/starting the
            platform-wide subscription is its own transaction, not part
            of this Gursha, per the spec's "regardless of the chosen
            amount" framing. */}
        <button type="button" className={styles.backToSubscribe} onClick={() => setSubExpanded((v) => !v)}>
          {platformSub ? `Birq+ active: ${formatSantimAsBirr(platformSub.amountSantim)}/mo — change?` : "Go ad-free platform-wide →"}
        </button>

        {subExpanded && (
          <div className={styles.badgeBlock}>
            <label className={styles.fieldLabel}>Monthly amount (min {formatSantimAsBirr(PLATFORM_SUBSCRIPTION_MIN_SANTIM)})</label>
            <div className={styles.tierRow}>
              {SUB_AMOUNT_PRESETS_SANTIM.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={subAmount === amt && !subCustomAmount ? styles.tierButtonActive : styles.tierButton}
                  onClick={() => {
                    setSubAmount(amt);
                    setSubCustomAmount("");
                  }}
                >
                  {formatSantimAsBirr(amt)}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={PLATFORM_SUBSCRIPTION_MIN_SANTIM / 100}
              className={styles.input}
              placeholder="Custom amount (ETB)"
              value={subCustomAmount}
              onChange={(e) => {
                const raw = e.target.value;
                setSubCustomAmount(raw);
                const etb = Math.max(PLATFORM_SUBSCRIPTION_MIN_SANTIM / 100, Number(raw) || 0);
                setSubAmount(Math.round(etb * 100));
              }}
            />
            <p className={styles.total}>
              Grants platform-wide ad-free viewing and a Sub Shield badge in chat, {formatSantimAsBirr(subAmount)}/mo.
            </p>
            {subError && <p className={styles.error}>{subError}</p>}
            {subSuccess && <p className={styles.success}>Subscription active!</p>}
            <button
              type="button"
              className={styles.sendButton}
              onClick={handleSubscribeToPlatform}
              disabled={subLoading}
            >
              {subLoading ? "Processing..." : platformSub ? "Update subscription" : "Subscribe"}
            </button>
          </div>
        )}

        <button type="button" className={styles.backToSubscribe} onClick={goToSubscribe}>
          Looking to subscribe to this creator instead? →
        </button>
      </div>
    </div>
  );
}
