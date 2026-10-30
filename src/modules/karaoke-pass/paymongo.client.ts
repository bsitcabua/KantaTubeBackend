import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getPayMongoRuntimeConfig,
  PayMongoRuntimeConfig,
} from './karaoke-pass.config';

type JsonRecord = Record<string, any>;

export interface PayMongoQrResult {
  paymentIntentId: string;
  paymentMethodId: string;
  paymentId: string | null;
  qrImageUrl: string;
  testUrl: string | null;
  qrExpiresAt: Date;
  status: string | null;
}

export interface PayMongoPaymentIntentStatus {
  paymentIntentId: string;
  status: string;
  amountCentavos: number | null;
  currency: string | null;
  paymentId: string | null;
  lastPaymentError: string | null;
}

@Injectable()
export class PayMongoClient {
  private readonly logger = new Logger(PayMongoClient.name);
  private readonly config: PayMongoRuntimeConfig;

  constructor(config: ConfigService) {
    this.config = getPayMongoRuntimeConfig(config);
    const modeLabel = this.config.mode.toUpperCase();
    this.logger.log(`PayMongo mode: ${this.config.mode}`);
    this.logger.log(
      `PayMongo ${modeLabel} credentials configured: ${this.config.secretKey ? 'yes' : 'no'}`,
    );
    this.logger.log(
      `PayMongo ${modeLabel} webhook verification configured: ${this.config.webhookSecret ? 'yes' : 'no'}`,
    );
  }

  get runtimeConfig(): PayMongoRuntimeConfig {
    return this.config;
  }

  async createQrPayment(input: {
    paymentIntentId?: string | null;
    amountCentavos: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
  }): Promise<PayMongoQrResult> {
    this.assertAvailable();
    let intent: JsonRecord;
    if (input.paymentIntentId) {
      intent = await this.request(
        `/payment_intents/${encodeURIComponent(input.paymentIntentId)}`,
        'GET',
      );
    } else {
      intent = await this.request(
        '/payment_intents',
        'POST',
        {
          data: {
            attributes: {
              amount: input.amountCentavos,
              currency: input.currency,
              payment_method_allowed: ['qrph'],
              description: input.description,
              metadata: input.metadata,
            },
          },
        },
        { 'Idempotency-Key': `kantatube-${input.metadata.purchase_id}` },
      );
    }

    let paymentIntentId = this.string(intent?.data?.id);
    let clientKey = this.string(intent?.data?.attributes?.client_key);
    if (!paymentIntentId || !clientKey)
      throw new Error('PayMongo returned an invalid Payment Intent.');

    let paymentMethodId = await this.createQrPaymentMethod();
    if (!paymentMethodId)
      throw new Error('PayMongo returned an invalid QR Ph Payment Method.');

    let attached: JsonRecord;
    try {
      attached = await this.request(
        `/payment_intents/${encodeURIComponent(paymentIntentId)}/attach`,
        'POST',
        {
          data: {
            attributes: {
              payment_method: paymentMethodId,
              client_key: clientKey,
            },
          },
        },
      );
    } catch (error) {
      // PayMongo may reject attaching a replacement QR to an expired intent.
      // Keep the KantaTube purchase and its audit reference, but create a new
      // intent only as the provider-required retry mechanism.
      if (!input.paymentIntentId) throw error;
      intent = await this.request(
        '/payment_intents',
        'POST',
        {
          data: {
            attributes: {
              amount: input.amountCentavos,
              currency: input.currency,
              payment_method_allowed: ['qrph'],
              description: input.description,
              metadata: input.metadata,
            },
          },
        },
        {
          'Idempotency-Key': `kantatube-${input.metadata.purchase_id}-retry-${Date.now()}`,
        },
      );
      const replacementIntentId = this.string(intent?.data?.id);
      const replacementClientKey = this.string(
        intent?.data?.attributes?.client_key,
      );
      if (!replacementIntentId || !replacementClientKey) throw error;
      paymentIntentId = replacementIntentId;
      clientKey = replacementClientKey;
      paymentMethodId = await this.createQrPaymentMethod();
      attached = await this.request(
        `/payment_intents/${encodeURIComponent(replacementIntentId)}/attach`,
        'POST',
        {
          data: {
            attributes: {
              payment_method: paymentMethodId,
              client_key: clientKey,
            },
          },
        },
      );
    }
    const attributes = attached?.data?.attributes ?? {};
    const qrImageUrl = this.string(attributes?.next_action?.code?.image_url);
    if (!qrImageUrl) throw new Error('PayMongo did not return a QR Ph image.');
    const testUrl = this.string(attributes?.next_action?.code?.test_url);
    const paymentId = this.findPaymentId(attributes);
    const qrExpiresAt = new Date(
      Date.now() + this.config.qrExpirySeconds * 1000,
    );
    return {
      paymentIntentId,
      paymentMethodId,
      paymentId,
      qrImageUrl,
      testUrl,
      qrExpiresAt,
      status: this.string(attributes.status),
    };
  }

  async getPaymentIntent(paymentIntentId: string): Promise<JsonRecord> {
    this.assertAvailable();
    return this.request(
      `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      'GET',
    );
  }

  async retrievePaymentIntent(
    paymentIntentId: string,
  ): Promise<PayMongoPaymentIntentStatus> {
    const payload = await this.getPaymentIntent(paymentIntentId);
    const data = payload?.data ?? {};
    const attributes = data?.attributes ?? {};
    return {
      paymentIntentId: this.string(data?.id) || paymentIntentId,
      status: this.string(attributes?.status).toLowerCase() || 'unknown',
      amountCentavos:
        Number.isInteger(attributes?.amount) && attributes.amount >= 0
          ? Number(attributes.amount)
          : null,
      currency: this.string(attributes?.currency).toUpperCase() || null,
      paymentId: this.findPaymentId(attributes),
      lastPaymentError: this.paymentErrorMessage(attributes?.last_payment_error),
    };
  }

  private async createQrPaymentMethod(): Promise<string> {
    const paymentMethod = await this.request('/payment_methods', 'POST', {
      data: {
        attributes: {
          type: 'qrph',
          expiry_seconds: this.config.qrExpirySeconds,
        },
      },
    });
    return this.string(paymentMethod?.data?.id);
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: JsonRecord,
    extraHeaders: Record<string, string> = {},
  ): Promise<JsonRecord> {
    const response = await fetch(`https://api.paymongo.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        payload?.errors?.[0]?.detail ||
        payload?.message ||
        `PayMongo request failed (${response.status}).`;
      const error = new Error(String(detail));
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return payload as JsonRecord;
  }

  private assertAvailable(): void {
    if (!this.config.available)
      throw new ServiceUnavailableException(
        'Payment setup is not available in this environment yet.',
      );
  }

  private findPaymentId(attributes: JsonRecord): string | null {
    const payments = Array.isArray(attributes.payments)
      ? attributes.payments
      : [];
    return (
      this.string(
        payments.find((payment: JsonRecord) => this.string(payment?.id))?.id,
      ) || null
    );
  }

  private paymentErrorMessage(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (!value || typeof value !== 'object') return null;
    const record = value as JsonRecord;
    const message = this.string(record.detail) || this.string(record.message);
    return message || null;
  }

  private string(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }
}
