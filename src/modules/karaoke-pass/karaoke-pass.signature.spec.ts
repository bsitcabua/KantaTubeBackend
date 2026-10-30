import { createHmac } from 'crypto';
import { KaraokePassService } from './karaoke-pass.service';

describe('PayMongo webhook signature verification', () => {
  function service(mode: 'test' | 'live'): KaraokePassService {
    const instance = Object.create(
      KaraokePassService.prototype,
    ) as KaraokePassService;
    (instance as any).paymongo = { runtimeConfig: { mode } };
    return instance;
  }

  it('verifies the mode-specific signature over the exact raw body', () => {
    const secret = 'whsec_test_example';
    const body = Buffer.from('{"data":{"id":"evt_123"}}');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const digest = createHmac('sha256', secret)
      .update(`${timestamp}.${body.toString('utf8')}`)
      .digest('hex');

    expect(
      service('test').verifyWebhookSignature(
        body,
        `t=${timestamp},te=${digest}`,
        secret,
      ),
    ).toBe(true);
    expect(
      service('test').verifyWebhookSignature(
        Buffer.from(`${body.toString('utf8')} `),
        `t=${timestamp},te=${digest}`,
        secret,
      ),
    ).toBe(false);
  });

  it('rejects missing mode signatures and stale timestamps', () => {
    const serviceInstance = service('live');
    const timestamp = (Math.floor(Date.now() / 1000) - 301).toString();

    expect(
      serviceInstance.verifyWebhookSignature(
        '{}',
        `t=${timestamp},te=${'a'.repeat(64)}`,
        'secret',
      ),
    ).toBe(false);
    expect(
      serviceInstance.verifyWebhookSignature(
        '{}',
        `t=${Math.floor(Date.now() / 1000)},te=${'a'.repeat(64)}`,
        'secret',
      ),
    ).toBe(false);
  });

  it('selects the signature component from the route mode, not a fallback mode', () => {
    const secret = 'whsec_test_example';
    const body = '{}';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const digest = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const instance = service('live');

    expect(
      instance.verifyWebhookSignature(
        body,
        `t=${timestamp},te=${digest}`,
        secret,
        'test',
      ),
    ).toBe(true);
    expect(
      instance.verifyWebhookSignature(
        body,
        `t=${timestamp},te=${digest}`,
        secret,
        'live',
      ),
    ).toBe(false);
  });
});
