import { env } from "../common/env.js";

// Module 4 — Telegram go-live announcements. Same empty-by-default
// stub-switch pattern as every other optional integration in this
// codebase (see wallet/chapa-client.ts) — no real Telegram bot has been
// registered yet, so this stays a silent no-op until TELEGRAM_BOT_TOKEN
// and TELEGRAM_CHANNEL_ID are both set. Platform-wide (one channel
// announcing every creator's go-live), not per-creator — there's no
// per-creator Telegram-subscriber list anywhere in this codebase to
// build a fan-out from, so this mirrors notifyFollowersCreatorLive's own
// in-app fan-out at the platform level instead of inventing a second,
// unrelated per-creator subscription system.
export const isTelegramConfigured = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID);

interface TelegramSendMessageResponse {
  ok: boolean;
  description?: string;
}

// Contract verified against https://core.telegram.org/bots/api#sendmessage
// (2026-08-07): POST https://api.telegram.org/bot<token>/sendMessage,
// JSON body {chat_id, text, parse_mode}, {ok: boolean} response.
export async function sendGoLiveAnnouncement(displayName: string, watchUrl: string): Promise<void> {
  if (!isTelegramConfigured) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHANNEL_ID,
        text: `🔴 ${displayName} is now live on Birq!\n${watchUrl}`,
        parse_mode: "HTML",
      }),
    });
    const data = (await res.json()) as TelegramSendMessageResponse;
    if (!res.ok || !data.ok) {
      console.error(`[telegram] sendMessage failed: ${res.status} ${data.description ?? "unknown error"}`);
    }
  } catch (err) {
    // Best-effort, same posture as every other Centrifugo/notification
    // fan-out in this codebase — a Telegram outage must never fail or
    // delay the go-live response itself.
    console.error("[telegram] sendMessage request failed:", err);
  }
}
