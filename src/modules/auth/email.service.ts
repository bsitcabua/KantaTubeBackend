import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendVerificationCode(email: string, code: string, subject = 'Your KantaTube verification code'): Promise<void> {
    const apiKey = this.config.get<string>('BREVO_API_KEY')?.trim();
    const fromEmail = this.config.get<string>('MAIL_FROM_EMAIL')?.trim();
    const fromName = this.config.get<string>('MAIL_FROM_NAME')?.trim() || 'KantaTube';
    if (!apiKey || !fromEmail) {
      this.logger.warn(
        `Email provider is not configured. Verification code for ${email}: ${code}`,
      );
      return;
    }

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { email: fromEmail, name: fromName },
          to: [{ email }],
          subject,
          htmlContent: `<p>Your KantaTube verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes.</p>`,
          textContent: `Your KantaTube verification code is: ${code}. This code expires in 10 minutes.`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(
          `Brevo rejected the email (${response.status}): ${details}`,
        );
      }
    } catch (error) {
      if (this.config.get<string>('NODE_ENV') !== 'production') {
        this.logger.warn(
          `Brevo failed during development: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        this.logger.warn(`Verification code fallback for ${email}: ${code}`);
      }
      throw new Error('Verification email could not be sent.');
    }
  }
}

// Previous Resend implementation retained for rollback/reference:
// const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
// const from = this.config.get<string>('MAIL_FROM')?.trim();
// await fetch('https://api.resend.com/emails', { ... });
