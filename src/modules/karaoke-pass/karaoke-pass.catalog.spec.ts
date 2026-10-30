import {
  addPlanDuration,
  KARAOKE_PASS_CATALOG,
  KaraokePassPlanCode,
  resolveKaraokePassPlan,
} from './karaoke-pass.catalog';

describe('KantaTube karaoke pass catalog', () => {
  it('keeps the server-authoritative PHP prices and durations', () => {
    expect(
      KARAOKE_PASS_CATALOG.map((plan) => [
        plan.code,
        plan.amountCentavos,
        plan.currency,
      ]),
    ).toEqual([
      [KaraokePassPlanCode.DAY, 5000, 'PHP'],
      [KaraokePassPlanCode.WEEK, 19900, 'PHP'],
      [KaraokePassPlanCode.MONTH, 49900, 'PHP'],
      [KaraokePassPlanCode.YEAR, 199900, 'PHP'],
    ]);
    expect(resolveKaraokePassPlan(' month ')?.code).toBe(
      KaraokePassPlanCode.MONTH,
    );
    expect(resolveKaraokePassPlan('unknown')).toBeUndefined();
    expect(KARAOKE_PASS_CATALOG.map((plan) => plan.maxQueueSongs)).toEqual([
      20,
      25,
      30,
      50,
    ]);
  });

  it('stacks calendar-day passes in UTC while keeping the day pass exactly 24 hours', () => {
    const start = new Date('2026-01-31T23:30:00.000Z');
    const day = addPlanDuration(resolveKaraokePassPlan('DAY')!, start);
    const month = addPlanDuration(resolveKaraokePassPlan('MONTH')!, start);

    expect(day.toISOString()).toBe('2026-02-01T23:30:00.000Z');
    expect(month.toISOString()).toBe('2026-03-02T23:30:00.000Z');
  });
});
