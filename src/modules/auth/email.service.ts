import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendVerificationCode(email: string, code: string, subject = 'Your KantaTube verification code'): Promise<void> {
    return this.sendCodeEmail(
      email,
      code,
      subject,
      'Your KantaTube verification code is:',
    );
  }

  async sendAccountRecoveryCode(email: string, code: string): Promise<void> {
    return this.sendCodeEmail(
      email,
      code,
      'Recover your KantaTube account',
      'We received a request to recover your deleted KantaTube account. Your recovery code is:',
      'If you did not request recovery, ignore this email. Your account will remain deleted.',
    );
  }

  async sendAccountDeletionConfirmation(
    email: string,
    deletedAt: Date,
    recoverableUntil: Date,
  ): Promise<void> {
    const timeZone =
      this.config.get<string>('ACCOUNT_EMAIL_TIME_ZONE')?.trim() ||
      'Asia/Manila';
    const deletedOn = this.formatDateTime(deletedAt, timeZone);
    const recoveryDeadline = this.formatDateTime(recoverableUntil, timeZone);
    const supportEmail = this.config.get<string>('SUPPORT_EMAIL')?.trim();
    const safeEmail = this.escapeHtml(email);
    const supportText = supportEmail
      ? `contact support immediately at ${supportEmail}`
      : 'contact KantaTube support immediately';
    const safeSupportText = this.escapeHtml(supportText);

    await this.sendEmail(
      email,
      'Your KantaTube Account Has Been Deleted',
      `<p>Your KantaTube account has been successfully deleted.</p>
<p><strong>Account:</strong> ${safeEmail}<br><strong>Deleted on:</strong> ${this.escapeHtml(deletedOn)}</p>
<p>If you deleted your account intentionally, no further action is required.</p>
<p>You can recover your account until <strong>${this.escapeHtml(recoveryDeadline)}</strong> by signing in with the same account and following the <strong>Recover Account</strong> process.</p>
<p>If you did not request this account deletion, please ${safeSupportText}.</p>`,
      `Your KantaTube account has been successfully deleted.\n\nAccount: ${email}\nDeleted on: ${deletedOn}\n\nIf you deleted your account intentionally, no further action is required.\n\nYou can recover your account until ${recoveryDeadline} by signing in with the same account and following the Recover Account process.\n\nIf you did not request this account deletion, please ${supportText}.`,
    );
  }

  private async sendCodeEmail(
    email: string,
    code: string,
    subject: string,
    introduction: string,
    footer = '',
  ): Promise<void> {
    await this.sendEmail(
      email,
      subject,
      `<p>${introduction}</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes.</p>${footer ? `<p>${footer}</p>` : ''}`,
      `${introduction} ${code}. This code expires in 10 minutes.${footer ? ` ${footer}` : ''}`,
      code,
    );
  }

  private async sendEmail(
    email: string,
    subject: string,
    htmlContent: string,
    textContent: string,
    developmentCode?: string,
  ): Promise<void> {
    const apiKey = this.config.get<string>('BREVO_API_KEY')?.trim();
    const fromEmail = this.config.get<string>('MAIL_FROM_EMAIL')?.trim();
    const fromName = this.config.get<string>('MAIL_FROM_NAME')?.trim() || 'KantaTube';
    if (!apiKey || !fromEmail) {
      this.logger.warn(
        developmentCode
          ? `Email provider is not configured. Verification code for ${email}: ${developmentCode}`
          : `Email provider is not configured. Skipped "${subject}" for ${email}.`,
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
          htmlContent,
          textContent,
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
        if (developmentCode)
          this.logger.warn(
            `Verification code fallback for ${email}: ${developmentCode}`,
          );
      }
      throw new Error('Email could not be sent.');
    }
  }

  private formatDateTime(value: Date, timeZone: string): string {
    try {
      return `${new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
        timeZoneName: 'short',
      }).format(value)} (${timeZone})`;
    } catch {
      return `${value.toISOString()} (UTC)`;
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;',
        })[character]!,
    );
  }
}

// Previous Resend implementation retained for rollback/reference:
// const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
// const from = this.config.get<string>('MAIL_FROM')?.trim();
// await fetch('https://api.resend.com/emails', { ... });
