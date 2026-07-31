export interface SmsGateway {
  sendOtp(phoneNumber: string, code: string): Promise<void>;
  sendGiftCard(phoneNumber: string, redemptionUrl: string, amountBirr: string): Promise<void>;
}

// Dev-only stub. Swap for a real Ethiopian SMS gateway (e.g. AfroMessage,
// Geez SMS) behind this same interface when credentials are available —
// no such credentials exist yet, same blocked-on-a-vendor-relationship
// situation as Chapa/AWS Rekognition elsewhere in this codebase.
class ConsoleSmsGateway implements SmsGateway {
  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    console.log(`[dev sms] OTP for ${phoneNumber}: ${code}`);
  }
  async sendGiftCard(phoneNumber: string, redemptionUrl: string, amountBirr: string): Promise<void> {
    console.log(`[dev sms] Gift card for ${phoneNumber}: ${amountBirr} ETB, ${redemptionUrl}`);
  }
}

export const smsGateway: SmsGateway = new ConsoleSmsGateway();
