import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

describe('EmailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends account deletion details with an explicit timezone and recovery guidance', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as typeof fetch;
    const service = new EmailService(
      new ConfigService({
        BREVO_API_KEY: 'test-key',
        MAIL_FROM_EMAIL: 'no-reply@kantatube.test',
        MAIL_FROM_NAME: 'KantaTube',
        ACCOUNT_EMAIL_TIME_ZONE: 'Asia/Manila',
        SUPPORT_EMAIL: 'support@kantatube.test',
      }),
    );

    await service.sendAccountDeletionConfirmation(
      'singer@example.com',
      new Date('2026-08-20T12:06:00.000Z'),
      new Date('2026-09-19T12:06:00.000Z'),
    );

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request.body as string);
    expect(body.subject).toBe('Your KantaTube Account Has Been Deleted');
    expect(body.textContent).toContain('Account: singer@example.com');
    expect(body.textContent).toContain('August 20, 2026');
    expect(body.textContent).toContain('8:06 PM');
    expect(body.textContent).toContain('Asia/Manila');
    expect(body.textContent).toContain('Recover Account');
    expect(body.textContent).toContain('support@kantatube.test');
  });
});
