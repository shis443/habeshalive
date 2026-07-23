export interface SmsGateway {
  sendOtp(phoneNumber: string, code: string): Promise<void>;
}

// Dev-only stub. Swap for a real Ethiopian SMS gateway (e.g. AfroMessage,
// Geez SMS) behind this same interface when credentials are available.
class ConsoleSmsGateway implements SmsGateway {
  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    console.log(`[dev sms] OTP for ${phoneNumber}: ${code}`);
  }
}

export const smsGateway: SmsGateway = new ConsoleSmsGateway();
