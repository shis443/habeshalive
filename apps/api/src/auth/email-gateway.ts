import { env } from "../common/env.js";

export interface EmailGateway {
  sendOtp(email: string, code: string): Promise<void>;
  sendGiftCard(email: string, redemptionUrl: string, amountBirr: string, personalMessage?: string): Promise<void>;
  sendNewDeviceLogin(email: string, details: { ip: string; userAgent: string }): Promise<void>;
}

// Dev-only stub — used whenever RESEND_API_KEY is unset, same switch
// pattern as wallet/chapa-client.ts. Keeps local dev and tests working
// without a real Resend account.
// Best-effort UA -> "Browser on OS" summary via simple substring checks —
// no GeoIP/City-Country here (that needs a real third-party database or
// API this codebase has no account for), just what a User-Agent string
// alone can honestly tell you. Order matters: Edge/Chrome-based browsers
// include "Safari" in their own UA string for legacy compatibility, so
// more specific checks must run first.
function describeUserAgent(userAgent: string): string {
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("OPR/")
      ? "Opera"
      : userAgent.includes("Chrome/")
        ? "Chrome"
        : userAgent.includes("Firefox/")
          ? "Firefox"
          : userAgent.includes("Safari/")
            ? "Safari"
            : "an unrecognized browser";
  const os = userAgent.includes("iPhone") || userAgent.includes("iPad")
    ? "iOS"
    : userAgent.includes("Android")
      ? "Android"
      : userAgent.includes("Mac OS X")
        ? "macOS"
        : userAgent.includes("Windows")
          ? "Windows"
          : userAgent.includes("Linux")
            ? "Linux"
            : "an unrecognized device";
  return `${browser} on ${os}`;
}

class ConsoleEmailGateway implements EmailGateway {
  async sendOtp(email: string, code: string): Promise<void> {
    console.log(`[dev email] OTP for ${email}: ${code}`);
  }
  async sendGiftCard(email: string, redemptionUrl: string, amountBirr: string): Promise<void> {
    console.log(`[dev email] Gift card for ${email}: ${amountBirr} ETB, ${redemptionUrl}`);
  }
  async sendNewDeviceLogin(email: string, details: { ip: string; userAgent: string }): Promise<void> {
    console.log(`[dev email] New login for ${email}: ${describeUserAgent(details.userAgent)}, IP ${details.ip}`);
  }
}

interface ResendSendResponse {
  id?: string;
  message?: string;
  name?: string;
}

// Real Resend "Send Email" call. Contract verified against
// https://resend.com/docs/api-reference/emails/send-email and
// https://resend.com/docs/api-reference/errors (2026-07-23): endpoint,
// auth header, required body fields, and the { id } success shape — not
// guessed from memory. Error responses aren't fully schema'd in Resend's
// own docs beyond message/name, so this reads both defensively rather
// than assuming a strict shape.
class ResendEmailGateway implements EmailGateway {
  async sendOtp(email: string, code: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: email,
        subject: `${code} is your Birq code`,
        text: `Your Birq sign-in code is ${code}. It expires in 5 minutes.`,
        html: `<p>Your Birq sign-in code is <strong>${code}</strong>. It expires in 5 minutes.</p>`,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ResendSendResponse;
      throw new Error(`Resend send failed: ${res.status} ${body.message ?? body.name ?? "unknown error"}`);
    }
  }

  async sendGiftCard(email: string, redemptionUrl: string, amountBirr: string, personalMessage?: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: email,
        subject: `You've received a ${amountBirr} ETB Birq gift card`,
        text: `You've received a ${amountBirr} ETB Birq gift card.${personalMessage ? `\n\n"${personalMessage}"` : ""}\n\nRedeem it here: ${redemptionUrl}`,
        html: `<p>You've received a <strong>${amountBirr} ETB</strong> Birq gift card.</p>${
          personalMessage ? `<p><em>"${personalMessage}"</em></p>` : ""
        }<p><a href="${redemptionUrl}">Redeem it here</a></p>`,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ResendSendResponse;
      throw new Error(`Resend send failed: ${res.status} ${body.message ?? body.name ?? "unknown error"}`);
    }
  }

  async sendNewDeviceLogin(email: string, details: { ip: string; userAgent: string }): Promise<void> {
    const device = describeUserAgent(details.userAgent);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: email,
        subject: "New login to your Birq account",
        text: `We noticed a new login to your Birq account from ${device}, IP address ${details.ip}.\n\nIf this was you, no action is needed. If you don't recognize this, change your password and enable 2FA in Settings right away.`,
        html: `<p>We noticed a new login to your Birq account from <strong>${device}</strong>, IP address <strong>${details.ip}</strong>.</p><p>If this was you, no action is needed. If you don't recognize this, change your password and enable 2FA in Settings right away.</p>`,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ResendSendResponse;
      throw new Error(`Resend send failed: ${res.status} ${body.message ?? body.name ?? "unknown error"}`);
    }
  }
}

export const emailGateway: EmailGateway = env.RESEND_API_KEY ? new ResendEmailGateway() : new ConsoleEmailGateway();
