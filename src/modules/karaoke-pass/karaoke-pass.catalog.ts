export enum KaraokePassPlanCode {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

export interface KaraokePassPlan {
  code: KaraokePassPlanCode;
  name: string;
  amountCentavos: number;
  currency: 'PHP';
  maxQueueSongs: number;
  durationHours?: number;
  durationDays?: number;
  durationLabel: string;
  badge?: string;
}

export const KARAOKE_PASS_CATALOG: readonly KaraokePassPlan[] = [
  {
    code: KaraokePassPlanCode.DAY,
    name: 'Day Pass',
    amountCentavos: 5000,
    currency: 'PHP',
    maxQueueSongs: 20,
    durationHours: 24,
    durationLabel: '24 hours',
  },
  {
    code: KaraokePassPlanCode.WEEK,
    name: 'Week Pass',
    amountCentavos: 19900,
    currency: 'PHP',
    maxQueueSongs: 25,
    durationDays: 7,
    durationLabel: '7 days',
  },
  {
    code: KaraokePassPlanCode.MONTH,
    name: 'Month Pass',
    amountCentavos: 49900,
    currency: 'PHP',
    maxQueueSongs: 30,
    durationDays: 30,
    durationLabel: '30 days',
    badge: 'Best Value',
  },
  {
    code: KaraokePassPlanCode.YEAR,
    name: 'Year Pass',
    amountCentavos: 199900,
    currency: 'PHP',
    maxQueueSongs: 50,
    durationDays: 365,
    durationLabel: '365 days',
  },
];

export function resolveKaraokePassPlan(
  value: unknown,
): KaraokePassPlan | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase() as KaraokePassPlanCode;
  return KARAOKE_PASS_CATALOG.find((plan) => plan.code === code);
}

export function addPlanDuration(plan: KaraokePassPlan, startsAt: Date): Date {
  const result = new Date(startsAt.getTime());
  if (plan.durationHours)
    result.setTime(result.getTime() + plan.durationHours * 60 * 60 * 1000);
  else result.setUTCDate(result.getUTCDate() + (plan.durationDays ?? 0));
  return result;
}

export function planResponse(plan: KaraokePassPlan) {
  return {
    code: plan.code,
    name: plan.name,
    price: plan.amountCentavos / 100,
    amountCentavos: plan.amountCentavos,
    currency: plan.currency,
    maxQueueSongs: plan.maxQueueSongs,
    durationLabel: plan.durationLabel,
    durationDays:
      plan.durationDays ?? (plan.durationHours ? plan.durationHours / 24 : 0),
    badge: plan.badge ?? null,
  };
}
