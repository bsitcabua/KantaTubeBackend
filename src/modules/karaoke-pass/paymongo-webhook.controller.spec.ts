import { BadRequestException } from '@nestjs/common';
import { PayMongoWebhookController } from './paymongo-webhook.controller';

describe('PayMongoWebhookController', () => {
  it('passes TEST and LIVE routes to the shared processor with explicit modes', () => {
    const service = {
      handleWebhook: jest.fn().mockResolvedValue({ received: true }),
    };
    const controller = new PayMongoWebhookController(service as never);
    const rawBody = Buffer.from('{}');
    const request = { rawBody } as never;

    controller.test(request, 'test-signature');
    controller.live(request, 'live-signature');

    expect(service.handleWebhook).toHaveBeenNthCalledWith(
      1,
      rawBody,
      'test-signature',
      'test',
    );
    expect(service.handleWebhook).toHaveBeenNthCalledWith(
      2,
      rawBody,
      'live-signature',
      'live',
    );
  });

  it('rejects a webhook when Nest raw-body capture is unavailable', () => {
    const controller = new PayMongoWebhookController({} as never);

    expect(() => controller.test({} as never, undefined)).toThrow(
      BadRequestException,
    );
  });
});
