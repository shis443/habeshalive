import { env } from "../common/env.js";

export interface EmailGateway {
  sendOtp(email: string, code: string): Promise<void>;
  sendGiftCard(email: string, redemptionUrl: string, amountBirr: string, personalMessage?: string): Promise<void>;
}

// Dev-only stub — used whenever RESEND_API_KEY is unset, same switch
// pattern as wallet/chapa-client.ts. Keeps local dev and tests working
// without a real Resend account.
class ConsoleEmailGateway implements EmailGateway {
  async sendOtp(email: string, code: string): Promise<void> {
    console.log(`[dev email] OTP for ${email}: ${code}`);
  }
  async sendGiftCard(email: string, redemptionUrl: string, amountBirr: string): Promise<void> {
    console.log(`[dev email] Gift card for ${email}: ${amountBirr} ETB, ${redemptionUrl}`);
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
}

export const emailGateway: EmailGateway = env.RESEND_API_KEY ? new ResendEmailGateway() : new ConsoleEmailGateway();
