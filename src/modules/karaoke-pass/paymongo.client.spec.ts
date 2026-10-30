import { ConfigService } from '@nestjs/config';
import { PayMongoClient } from './paymongo.client';

describe('PayMongoClient mode selection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the TEST secret for all server-side TEST API calls', async () => {
    const config = new ConfigService({
      PAYMONGO_MODE: 'test',
      PAYMONGO_TEST_SECRET_KEY: 'sk_test_example',
      PAYMONGO_TEST_WEBHOOK_SECRET: 'whsec_test_example',
      PAYMONGO_LIVE_SECRET_KEY: 'sk_live_must_not_be_used',
      PAYMONGO_LIVE_WEBHOOK_SECRET: 'whsec_live_must_not_be_used',
      PAYMONGO_QRPH_EXPIRY_SECONDS: '60',
    });
    const responses = [
      {
        data: {
          id: 'pi_test_123',
          attributes: { client_key: 'pk_client_test' },
        },
      },
      { data: { id: 'pm_qrph_test_123' } },
      {
        data: {
          attributes: {
            status: 'awaiting_payment_method',
            next_action: {
              code: {
                image_url: 'https://example.test/qr.png',
                test_url: 'https://example.test/simulate/123',
              },
            },
            payments: [{ id: 'pay_test_123' }],
          },
        },
      },
    ];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify(responses.shift()), { status: 200 }),
      );
    const client = new PayMongoClient(config);

    const result = await client.createQrPayment({
      amountCentavos: 5000,
      currency: 'PHP',
      description: 'Test pass',
      metadata: { purchase_id: 'purchase-1' },
    });

    expect(client.runtimeConfig.mode).toBe('test');
    expect(result.paymentIntentId).toBe('pi_test_123');
    expect(result.qrImageUrl).toBe('https://example.test/qr.png');
    expect(result.testUrl).toBe('https://example.test/simulate/123');
    for (const [, init] of fetchMock.mock.calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        `Basic ${Buffer.from('sk_test_example:').toString('base64')}`,
      );
      expect(headers.Authorization).not.toContain('sk_live_must_not_be_used');
    }
  });

  it('retrieves and normalizes Payment Intent status without exposing provider payloads', async () => {
    const config = new ConfigService({
      PAYMONGO_MODE: 'test',
      PAYMONGO_TEST_SECRET_KEY: 'sk_test_example',
      PAYMONGO_TEST_WEBHOOK_SECRET: 'whsec_test_example',
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'pi_test_status',
            attributes: {
              status: 'succeeded',
              amount: 5000,
              currency: 'PHP',
              payments: [{ id: 'pay_test_status' }],
              last_payment_error: { detail: 'not returned on success' },
            },
          },
        }),
        { status: 200 },
      ),
    );
    const client = new PayMongoClient(config);

    await expect(client.retrievePaymentIntent('pi_test_status')).resolves.toEqual({
      paymentIntentId: 'pi_test_status',
      status: 'succeeded',
      amountCentavos: 5000,
      currency: 'PHP',
      paymentId: 'pay_test_status',
      lastPaymentError: 'not returned on success',
    });
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/payment_intents/pi_test_status');
  });
});
