import { env } from "../common/env.js";

export interface CheckoutCustomer {
  email: string;
  firstName: string;
  lastName: string;
}

export interface ChapaClient {
  initializeCheckout(
    amountSantim: number,
    txRef: string,
    customer: CheckoutCustomer
  ): Promise<{ checkoutUrl: string }>;
}

// Dev-only stub — used whenever CHAPA_SECRET_KEY is unset (see env.ts and
// the selection at the bottom of this file). Keeps local dev and the test
// suite working without a real Chapa account.
class StubChapaClient implements ChapaClient {
  async initializeCheckout(_amountSantim: number, txRef: string): Promise<{ checkoutUrl: string }> {
    return { checkoutUrl: `https://stub-checkout.chapa.co/pay/${txRef}` };
  }
}

interface ChapaInitializeResponse {
  status: string;
  message: string;
  data?: { checkout_url: string };
}

// Real Chapa "Initialize Transaction" call. Contract verified against
// https://developer.chapa.co/docs/accept-payments (2026-07-22): endpoint,
// auth header, required body fields, and the data.checkout_url response
// shape — not guessed from memory.
class RealChapaClient implements ChapaClient {
  async initializeCheckout(
    amountSantim: number,
    txRef: string,
    customer: CheckoutCustomer
  ): Promise<{ checkoutUrl: string }> {
    const res = await fetch("https://api.chapa.co/v1/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CHAPA_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Chapa's amount is decimal ETB, not santim (birr cents).
        amount: (amountSantim / 100).toFixed(2),
        currency: "ETB",
        email: customer.email,
        first_name: customer.firstName,
        last_name: customer.lastName,
        tx_ref: txRef,
        callback_url: `${env.API_PUBLIC_URL}/wallet/webhooks/chapa`,
        return_url: `${env.WEB_PUBLIC_URL}/wallet`,
        customization: { title: "HabeshaLive", description: "Wallet top-up" },
      }),
    });

    const body = (await res.json()) as ChapaInitializeResponse;
    if (!res.ok || body.status !== "success" || !body.data?.checkout_url) {
      throw new Error(`Chapa initialize failed: ${res.status} ${body.message ?? "unknown error"}`);
    }
    return { checkoutUrl: body.data.checkout_url };
  }
}

export const chapaClient: ChapaClient = env.CHAPA_SECRET_KEY ? new RealChapaClient() : new StubChapaClient();

export interface TransferRequest {
  accountNumber: string;
  accountName: string;
  amountSantim: number;
  bankCode: string;
  reference: string;
}

export interface ChapaPayoutClient {
  initiateTransfer(input: TransferRequest): Promise<{ chapaReference: string }>;
  // Resolves a bank's Chapa bank_code by (case-insensitive, substring)
  // name match — used to auto-resolve "telebirr" payouts, which don't ask
  // the user for a bank_code. Throws if no match, rather than guessing:
  // sending money with a wrong/guessed bank_code is a real-money mistake,
  // not a recoverable one.
  resolveBankCodeByName(nameFragment: string): Promise<string>;
}

// Dev-only stub — used whenever CHAPA_SECRET_KEY is unset, same switch as
// ChapaClient above.
class StubChapaPayoutClient implements ChapaPayoutClient {
  async initiateTransfer(input: TransferRequest): Promise<{ chapaReference: string }> {
    return { chapaReference: `stub_transfer_${input.reference}` };
  }
  async resolveBankCodeByName(): Promise<string> {
    return "stub-bank-code";
  }
}

interface ChapaTransferResponse {
  status: string;
  message: string;
  data?: { reference?: string; chapa_reference?: string } | null;
}

interface ChapaBank {
  id: number | string;
  name: string;
}

interface ChapaBanksResponse {
  status: string;
  data?: ChapaBank[];
}

// Real Chapa Transfer API. Contract verified against
// https://developer.chapa.co/transfer/transfers and
// https://developer.chapa.co/transfer/list-banks (2026-07-22) — endpoints,
// auth, and required body fields, not guessed from memory. Chapa's docs
// don't fully specify the success response shape ("refer to error codes
// page"), so this reads both plausible reference field names defensively
// and fails loudly if neither is present, rather than silently proceeding
// without a reference to reconcile against later webhooks.
class RealChapaPayoutClient implements ChapaPayoutClient {
  private bankCache: { banks: ChapaBank[]; fetchedAt: number } | null = null;

  async initiateTransfer(input: TransferRequest): Promise<{ chapaReference: string }> {
    const res = await fetch("https://api.chapa.co/v1/transfers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CHAPA_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_number: input.accountNumber,
        account_name: input.accountName,
        // Chapa's amount is decimal ETB, not santim (birr cents).
        amount: (input.amountSantim / 100).toFixed(2),
        currency: "ETB",
        bank_code: input.bankCode,
        // Our own reference, echoed back on the transfer-status webhook —
        // callers pass the payouts.id row so the webhook can look it up
        // directly (see wallet/service.ts completePayoutFromWebhook).
        reference: input.reference,
      }),
    });

    const body = (await res.json()) as ChapaTransferResponse;
    if (!res.ok || body.status !== "success") {
      throw new Error(`Chapa transfer failed: ${res.status} ${body.message ?? "unknown error"}`);
    }
    const chapaReference = body.data?.chapa_reference ?? body.data?.reference;
    if (!chapaReference) {
      throw new Error("Chapa transfer response had no reference to reconcile against");
    }
    return { chapaReference };
  }

  async resolveBankCodeByName(nameFragment: string): Promise<string> {
    const banks = await this.listBanks();
    const match = banks.find((bank) => bank.name.toLowerCase().includes(nameFragment.toLowerCase()));
    if (!match) throw new Error(`No Chapa bank found matching "${nameFragment}"`);
    return String(match.id);
  }

  private async listBanks(): Promise<ChapaBank[]> {
    const oneHourMs = 60 * 60 * 1000;
    if (this.bankCache && Date.now() - this.bankCache.fetchedAt < oneHourMs) {
      return this.bankCache.banks;
    }
    const res = await fetch("https://api.chapa.co/v1/banks", {
      headers: { Authorization: `Bearer ${env.CHAPA_SECRET_KEY}` },
    });
    const body = (await res.json()) as ChapaBanksResponse;
    if (!res.ok || !body.data) {
      throw new Error(`Chapa list-banks failed: ${res.status}`);
    }
    this.bankCache = { banks: body.data, fetchedAt: Date.now() };
    return body.data;
  }
}

export const chapaPayoutClient: ChapaPayoutClient = env.CHAPA_SECRET_KEY
  ? new RealChapaPayoutClient()
  : new StubChapaPayoutClient();
