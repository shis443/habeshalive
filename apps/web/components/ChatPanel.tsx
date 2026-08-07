"use client";

import type { ChatMessage, GifterBadgeTier, GiftTier, PinnedMessage, Rank, StreamActivity } from "@habeshalive/shared";
import { Centrifuge } from "centrifuge";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { API_BASE_URL, CENTRIFUGO_WS_URL } from "@/lib/config";
import { openAuthModal } from "@/lib/useAuthModal";
import { formatViewerCount } from "@/lib/format";
import { useChatSettings } from "@/lib/useChatSettings";
import { usernameColor } from "@/lib/userColor";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { ChatSettingsPanel } from "./ChatSettingsPanel";
import { DonateModal } from "./DonateModal";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { GurshaModal } from "./GurshaModal";
import { CloseIcon, GiftIcon, PinIcon, SendIcon, WalletIcon } from "./icons";
import styles from "./ChatPanel.module.css";
import { PinnedMessageBar } from "./PinnedMessageBar";
import { RecentGiftersStrip } from "./RecentGiftersStrip";
import { StreamActivityStrip } from "./StreamActivityStrip";
import { ViewerListPanel } from "./ViewerListPanel";

const BADGE_EMOJI: Record<GifterBadgeTier, string> = {
  none: "",
  bronze: "🥉",
  silver: "🥈",
  gold: "🥇",
  platinum: "💎",
};
const ROLE_EMOJI: Record<ChatMessage["senderRole"], string> = {
  viewer: "",
  creator: "",
  moderator: "🛡️",
  // db/migrations/0026_rbac_role_isolation.sql renamed 'admin' to
  // 'super_admin'.
  super_admin: "👑",
  // Read-only financial access, not a chat-relevant distinction — no
  // badge, same as viewer/creator.
  finance_auditor: "",
  // Legacy value, still possible at runtime during the deploy window —
  // see packages/shared/src/schemas/admin.ts's identical schema comment.
  // Same crown as super_admin, its direct successor.
  admin: "👑",
};

// Platform-wide Rank, distinct from BADGE_EMOJI above (per-creator gifter
// tier) — named after historical Ethiopian military/administrative titles,
// see db/migrations/0025_gursha_gift_economy.sql. "newari" (the default)
// renders nothing, same "none means never rendered" convention as
// BADGE_EMOJI.none.
const RANK_EMOJI: Record<Rank, string> = {
  newari: "",
  asir_aleka: "🔹",
  meto_aleka: "🔶",
  shi_aleka: "🎖️",
  dejazmach: "⚜️",
};
// Distinct from ROLE_EMOJI.moderator's 🛡️ (a different concept: platform
// role vs. an active paid subscription) despite both being "shield-ish."
const SUB_SHIELD_EMOJI = "🔰";

type ChatEntry =
  | { id: string; kind: "system"; text: string }
  | {
      id: string;
      kind: "message";
      userId: string;
      username: string;
      text: string;
      gifterBadgeTier: GifterBadgeTier;
      senderRole: ChatMessage["senderRole"];
      subscriberMonths: number | null;
      rank: Rank;
      hasSubShield: boolean;
      createdAt: string;
    };

function toEntry(m: ChatMessage): ChatEntry {
  return {
    id: m.id,
    kind: "message",
    userId: m.userId,
    username: m.displayName,
    text: m.body,
    gifterBadgeTier: m.gifterBadgeTier,
    senderRole: m.senderRole,
    subscriberMonths: m.subscriberMonths,
    rank: m.rank,
    hasSubShield: m.hasSubShield,
    createdAt: m.createdAt,
  };
}

async function fetchChatToken(): Promise<string> {
  // Deliberately hits the API directly (not the /api/backend proxy) — this
  // route is public on purpose, so anonymous viewers get real-time updates
  // too. Going through the proxy would 401 anyone without a session, since
  // the proxy itself requires one regardless of what the target route
  // needs. See apps/api/src/chat/token.ts.
  const res = await fetch(`${API_BASE_URL}/chat/token`, { method: "POST" });
  const data = await res.json();
  return data.token as string;
}

export function ChatPanel({
  streamId,
  creatorId,
  viewerCount,
  giftTiers,
  isAuthed,
  currentUsername,
  currentUserId,
  currentUserRole,
  activity,
}: {
  streamId: string;
  creatorId: string;
  viewerCount: number;
  giftTiers: GiftTier[];
  isAuthed: boolean;
  currentUsername: string | null;
  currentUserId: string | null;
  // db/migrations/0026_rbac_role_isolation.sql renamed 'admin' to
  // 'super_admin' and added 'finance_auditor' (not a chat-moderation
  // grant, deliberately excluded from canModerate below). Legacy 'admin'
  // stays in this union permanently — see
  // packages/shared/src/schemas/admin.ts's identical schema comment for
  // why this must reflect every value the DB can legitimately hold
  // during the deploy window, not just the post-migration set.
  currentUserRole: "viewer" | "creator" | "moderator" | "super_admin" | "finance_auditor" | "admin" | null;
  activity: StreamActivity;
}) {
  const t = useTranslations("chat");
  const { settings, update: updateSettings } = useChatSettings();
  // Lazy initializer, not a module-level constant — needs useTranslations,
  // which only works inside a component. Runs once at mount only: if the
  // viewer switches language mid-session this already-seeded message
  // doesn't retroactively re-translate, same accepted tradeoff as the
  // English-first-paint flash documented in IntlProvider.tsx — not worth
  // an effect just to keep one ephemeral system message perfectly in sync.
  const [messages, setMessages] = useState<ChatEntry[]>(() => [
    { id: "sys-welcome", kind: "system", text: t("welcome") },
  ]);
  const [pinnedMessage, setPinnedMessage] = useState<PinnedMessage | null>(null);
  const [balanceSantim, setBalanceSantim] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [gurshaModalOpen, setGurshaModalOpen] = useState(false);
  const [donateModalOpen, setDonateModalOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const canModerate =
    isAuthed &&
    !!currentUserId &&
    (currentUserId === creatorId ||
      currentUserRole === "moderator" ||
      currentUserRole === "super_admin" ||
      // Legacy value, still possible at runtime during the deploy window
      // — see the currentUserRole prop's own comment above.
      currentUserRole === "admin");

  // Real chatters to target with "Gursha a specific viewer" — drawn from
  // who's actually spoken in this session rather than a separate
  // "who's connected" API call the platform doesn't have.
  const recentChatters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of messages) {
      if (entry.kind === "message" && entry.username !== currentUsername) {
        seen.set(entry.userId, entry.username);
      }
    }
    return Array.from(seen, ([userId, username]) => ({ userId, username }));
  }, [messages, currentUsername]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/chat/${streamId}/pinned`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setPinnedMessage)
      .catch(() => {});
  }, [streamId]);

  useEffect(() => {
    if (!isAuthed) return;
    fetch("/api/backend/wallet/balance")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setBalanceSantim(data.balanceSantim);
      })
      .catch(() => {});
  }, [isAuthed]);

  useEffect(() => {
    let cancelled = false;
    const centrifuge = new Centrifuge(CENTRIFUGO_WS_URL, {
      getToken: fetchChatToken,
    });

    // Dedup-merge rather than blind-append: this runs on the initial mount
    // AND again every time the subscription resubscribes after a dropped
    // connection (mobile network blip, tab backgrounded and resumed) — see
    // the "subscribed" handler below. Anything published while the socket
    // was down never arrives as a "publication" event (that only fires for
    // messages published while actively connected), so without this
    // catch-up fetch on reconnect, a gap in the WS connection means a
    // permanent gap in that viewer's chat until they manually reload.
    function syncHistory() {
      fetch(`${API_BASE_URL}/chat/${streamId}/messages`)
        .then((res) => res.json())
        .then((history: ChatMessage[]) => {
          if (cancelled) return;
          setMessages((prev) => {
            const existingIds = new Set(prev.map((entry) => entry.id));
            const missing = history.filter((m) => !existingIds.has(m.id));
            if (missing.length === 0) return prev;
            return [...prev, ...missing.map(toEntry)];
          });
        })
        .catch(() => {
          // A history load failure shouldn't block live updates from still
          // working — the WS subscription below is independent of this.
        });
    }

    syncHistory();

    const sub = centrifuge.newSubscription(`stream-chat:${streamId}`);
    sub.on("publication", (ctx) => {
      const data = ctx.data as
        | { type: "message"; message: ChatMessage }
        | { type: "pin"; pinnedMessage: PinnedMessage | null };
      if (data.type === "pin") {
        setPinnedMessage(data.pinnedMessage);
        return;
      }
      const m = data.message;
      setMessages((prev) => {
        // Own messages are also appended in handleSend once its POST
        // resolves, and the two can arrive in either order (the server
        // publishes to Centrifugo before responding to the POST, so this
        // WS echo often wins the race) — dedup by id regardless of which
        // side runs first.
        if (prev.some((entry) => entry.id === m.id)) return prev;
        return [...prev, toEntry(m)];
      });
    });
    // Fires on the first successful subscribe AND again on every
    // resubscribe after a reconnect — re-syncing here (not just on mount)
    // is what actually closes the "missed messages during a drop" gap.
    sub.on("subscribed", syncHistory);
    sub.subscribe();
    centrifuge.connect();

    return () => {
      cancelled = true;
      sub.unsubscribe();
      centrifuge.disconnect();
    };
  }, [streamId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function dismissSystemMessage(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body) return;
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/backend/chat/${streamId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Failed to send");
      // Append immediately from the POST response rather than waiting on
      // the Centrifugo round-trip: a viewer who sends right after the page
      // loads can easily do so before the WS subscription (an async
      // getToken fetch, then connect+subscribe) finishes establishing,
      // which silently drops the echo for that message — the sender would
      // never see their own message without a manual reload. Dedup by id
      // here too, not just in the subscription handler below: the server
      // publishes to Centrifugo before responding to this POST, so the WS
      // echo can (and often does) reach the client before this fetch's
      // response does — without this check, both paths append the same
      // message and it shows up twice.
      const sent: ChatMessage = await res.json();
      setMessages((prev) => {
        if (prev.some((entry) => entry.id === sent.id)) return prev;
        return [...prev, toEntry(sent)];
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, kind: "system", text: "Message failed to send — try again." },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleGurshaClick() {
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setGurshaModalOpen(true);
  }

  function handleDonateClick() {
    if (!isAuthed) {
      openAuthModal();
      return;
    }
    setDonateModalOpen(true);
  }

  async function handlePin(messageId: string) {
    try {
      const res = await fetch(`/api/backend/chat/${streamId}/pinned`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (res.ok) setPinnedMessage(await res.json());
    } catch {
      // Pinning is a moderation nicety, not core chat — a failure here
      // just leaves the old pin (or none) in place.
    }
  }

  async function handleUnpin() {
    try {
      await fetch(`/api/backend/chat/${streamId}/pinned`, { method: "DELETE" });
      setPinnedMessage(null);
    } catch {
      // Same as above — best-effort.
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Stream Chat</span>
        <div className={styles.headerIcons}>
          <span className={styles.counter}>{formatViewerCount(viewerCount)}</span>
          <ViewerListPanel streamId={streamId} />
          <ChatSettingsPanel settings={settings} onChange={updateSettings} />
        </div>
      </div>

      <AnnouncementBanner />

      {pinnedMessage && (
        <PinnedMessageBar pinned={pinnedMessage} canUnpin={canModerate} onUnpin={handleUnpin} />
      )}

      <RecentGiftersStrip streamId={streamId} />

      <StreamActivityStrip events={activity.recentEvents} />

      <div className={`${styles.messages} ${styles[`font-${settings.fontSize}`]}`}>
        {messages.map((entry) =>
          entry.kind === "system" ? (
            <div key={entry.id} className={styles.systemMessage}>
              <p className={styles.systemText}>{entry.text}</p>
              <button
                type="button"
                className={styles.dismissButton}
                onClick={() => dismissSystemMessage(entry.id)}
                aria-label="Dismiss"
              >
                <CloseIcon />
              </button>
            </div>
          ) : (
            <p key={entry.id} className={styles.message}>
              {settings.showTimestamps && (
                <span className={styles.timestamp}>
                  {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{" "}
                </span>
              )}
              {ROLE_EMOJI[entry.senderRole] && (
                <span
                  className={settings.largeEmoji ? styles.badgeLarge : styles.badge}
                  title={entry.senderRole}
                >
                  {ROLE_EMOJI[entry.senderRole]}{" "}
                </span>
              )}
              {entry.hasSubShield && (
                <span className={settings.largeEmoji ? styles.badgeLarge : styles.badge} title="Birq+ subscriber">
                  {SUB_SHIELD_EMOJI}{" "}
                </span>
              )}
              {RANK_EMOJI[entry.rank] && (
                <span className={settings.largeEmoji ? styles.badgeLarge : styles.badge} title={`Rank: ${entry.rank}`}>
                  {RANK_EMOJI[entry.rank]}{" "}
                </span>
              )}
              {entry.subscriberMonths !== null && (
                <span className={styles.subBadge} title={`Subscribed ${entry.subscriberMonths}mo`}>
                  ⭐{entry.subscriberMonths}mo{" "}
                </span>
              )}
              {entry.gifterBadgeTier !== "none" && (
                <span
                  className={settings.largeEmoji ? styles.badgeLarge : styles.badge}
                  title={`${entry.gifterBadgeTier} gifter`}
                >
                  {BADGE_EMOJI[entry.gifterBadgeTier]}{" "}
                </span>
              )}
              <span className={styles.username} style={{ color: usernameColor(entry.username) }}>
                {entry.username}
              </span>{" "}
              {entry.text}
              {canModerate && (
                <button
                  type="button"
                  className={styles.pinTrigger}
                  onClick={() => handlePin(entry.id)}
                  aria-label="Pin this message"
                  title="Pin this message"
                >
                  <PinIcon />
                </button>
              )}
            </p>
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.counters}>
        <span className={styles.counter}>🎁 {activity.giftsCount} Gursha this stream</span>
        <span className={styles.counter}>⭐ {activity.activeSubscribers} subscribers</span>
      </div>

      <div className={styles.inputArea}>
        <form className={styles.inputRow} onSubmit={handleSend}>
          <input
            type="text"
            placeholder={t("placeholder")}
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
          />
          <EmojiPickerButton onSelect={(emoji) => setInput((prev) => prev + emoji)} />
          <button
            type="button"
            className={`${styles.iconButton} ${styles.giftButton}`}
            aria-label="Send Gursha"
            onClick={handleGurshaClick}
          >
            <GiftIcon />
          </button>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.giftButton}`}
            aria-label="Send a donation"
            onClick={handleDonateClick}
          >
            <WalletIcon />
          </button>
          <button type="submit" className={`${styles.iconButton} ${styles.sendButton}`} aria-label="Send" disabled={sending}>
            <SendIcon />
          </button>
        </form>
        {!isAuthed && <p className={styles.loginHint}>Log in to chat and send Gursha.</p>}
        {isAuthed && balanceSantim !== null && (
          <p className={styles.balanceHint}>Wallet: {(balanceSantim / 100).toFixed(2)} birr</p>
        )}
      </div>

      {gurshaModalOpen && (
        <GurshaModal
          streamId={streamId}
          creatorId={creatorId}
          giftTiers={giftTiers}
          isAuthed={isAuthed}
          recentChatters={recentChatters}
          onClose={() => setGurshaModalOpen(false)}
        />
      )}

      {donateModalOpen && (
        <DonateModal streamId={streamId} isAuthed={isAuthed} onClose={() => setDonateModalOpen(false)} />
      )}
    </div>
  );
}
