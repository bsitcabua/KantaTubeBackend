import { KaraokePassEntitlement } from './entities/karaoke-pass-entitlement.entity';
import { KaraokePassAccessService } from './karaoke-pass-access.service';

function entitlement(
  purchaseId: string,
  planCode: string,
  startsAt: string,
  expiresAt: string,
): KaraokePassEntitlement {
  return Object.assign(new KaraokePassEntitlement(), {
    id: `entitlement-${purchaseId}`,
    userId: 'user-1',
    purchaseId,
    planCode,
    startsAt: new Date(startsAt),
    expiresAt: new Date(expiresAt),
  });
}

describe('KaraokePassAccessService', () => {
  it('returns the current pass, next pass, and final continuous access horizon', async () => {
    const rows = [
      entitlement(
        'purchase-day',
        'DAY',
        '2026-10-29T00:00:00.000Z',
        '2026-10-30T12:00:00.000Z',
      ),
      entitlement(
        'purchase-week',
        'WEEK',
        '2026-10-30T12:00:00.000Z',
        '2026-11-06T12:00:00.000Z',
      ),
      entitlement(
        'purchase-month',
        'MONTH',
        '2026-11-06T12:00:00.000Z',
        '2026-12-06T12:00:00.000Z',
      ),
    ];
    const repository = { find: jest.fn().mockResolvedValue(rows) };
    const service = new KaraokePassAccessService(repository as never);

    const result = await service.getSummary(
      'user-1',
      new Date('2026-10-29T12:00:00.000Z'),
    );

    expect(result.active).toBe(true);
    expect(result.current).toEqual(expect.objectContaining({
      purchaseId: 'purchase-day',
      planCode: 'DAY',
      planName: 'Day Pass',
    }));
    expect(result.scheduled.map((item) => item.planCode)).toEqual(['WEEK', 'MONTH']);
    expect(result.accessUntil).toBe('2026-12-06T12:00:00.000Z');
    expect(result.horizonExpiresAt).toBe(result.accessUntil);
    expect(result.remainingSeconds).toBe(3_283_200);
  });

  it('does not include an unrelated future entitlement after a gap', async () => {
    const rows = [
      entitlement(
        'purchase-day',
        'DAY',
        '2026-10-29T00:00:00.000Z',
        '2026-10-30T12:00:00.000Z',
      ),
      entitlement(
        'purchase-week',
        'WEEK',
        '2026-11-01T12:00:00.000Z',
        '2026-11-08T12:00:00.000Z',
      ),
    ];
    const repository = { find: jest.fn().mockResolvedValue(rows) };
    const service = new KaraokePassAccessService(repository as never);

    const result = await service.getSummary(
      'user-1',
      new Date('2026-10-29T12:00:00.000Z'),
    );

    expect(result.scheduled).toEqual([]);
    expect(result.accessUntil).toBe('2026-10-30T12:00:00.000Z');
  });
});
