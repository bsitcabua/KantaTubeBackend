import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, MoreThan, Repository } from 'typeorm';
import { KaraokePassEntitlement } from './entities/karaoke-pass-entitlement.entity';
import {
  KaraokePassPlanCode,
  resolveKaraokePassPlan,
} from './karaoke-pass.catalog';

export interface KaraokePassEntitlementSummary {
  purchaseId: string;
  planCode: KaraokePassPlanCode | string;
  planName: string;
  durationLabel: string;
  startsAt: string;
  expiresAt: string;
}

export interface KaraokePassAccessSummary {
  active: boolean;
  planCode: KaraokePassPlanCode | string | null;
  startsAt: string | null;
  expiresAt: string | null;
  horizonExpiresAt: string | null;
  current: KaraokePassEntitlementSummary | null;
  scheduled: KaraokePassEntitlementSummary[];
  accessUntil: string | null;
  remainingSeconds: number;
}

type EntitlementListener = (userId: string) => void | Promise<void>;

@Injectable()
export class KaraokePassAccessService {
  private readonly listeners = new Set<EntitlementListener>();

  constructor(
    @InjectRepository(KaraokePassEntitlement)
    private readonly entitlements: Repository<KaraokePassEntitlement>,
  ) {}

  async getSummary(
    userId: string,
    now = new Date(),
  ): Promise<KaraokePassAccessSummary> {
    const rows = await this.entitlements.find({
      where: { userId, expiresAt: MoreThan(now) },
      order: { startsAt: 'ASC' },
    });
    const active = rows.find(
      (row) => row.startsAt <= now && row.expiresAt > now,
    );

    if (!active) {
      return {
        active: false,
        planCode: null,
        startsAt: null,
        expiresAt: null,
        horizonExpiresAt: null,
        current: null,
        scheduled: [],
        accessUntil: null,
        remainingSeconds: 0,
      };
    }

    // Entitlements are stacked by starting the next pass at the previous
    // expiry. Keep the API authoritative about that continuous chain and do
    // not include an unrelated future entitlement after a gap.
    const activeIndex = rows.findIndex((row) => row.id === active.id);
    const chain = [active];
    let chainExpiry = active.expiresAt;
    for (const row of rows.slice(activeIndex + 1)) {
      if (row.startsAt > chainExpiry) break;
      chain.push(row);
      if (row.expiresAt > chainExpiry) chainExpiry = row.expiresAt;
    }

    const current = this.toEntitlementSummary(active);
    const scheduled = chain.slice(1).map((row) => this.toEntitlementSummary(row));
    const accessUntil = chainExpiry.toISOString();
    return {
      active: true,
      planCode: active.planCode,
      startsAt: active.startsAt.toISOString(),
      expiresAt: active.expiresAt.toISOString(),
      horizonExpiresAt: accessUntil,
      current,
      scheduled,
      accessUntil,
      remainingSeconds: Math.max(
        0,
        Math.floor((chainExpiry.getTime() - now.getTime()) / 1000),
      ),
    };
  }

  private toEntitlementSummary(
    row: KaraokePassEntitlement,
  ): KaraokePassEntitlementSummary {
    const plan = resolveKaraokePassPlan(row.planCode);
    return {
      purchaseId: row.purchaseId,
      planCode: row.planCode,
      planName: plan?.name ?? `${row.planCode} Pass`,
      durationLabel: plan?.durationLabel ?? '',
      startsAt: row.startsAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async latestExpiry(
    userId: string,
    now = new Date(),
    manager?: EntityManager,
  ): Promise<Date | null> {
    const repository = manager
      ? manager.getRepository(KaraokePassEntitlement)
      : this.entitlements;
    const row = await repository.findOne({
      where: { userId, expiresAt: MoreThan(now) },
      order: { expiresAt: 'DESC' },
    });
    return row?.expiresAt ?? null;
  }

  subscribe(listener: EntitlementListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async notifyEntitlementActivated(userId: string): Promise<void> {
    await Promise.all(
      [...this.listeners].map((listener) =>
        Promise.resolve(listener(userId)).catch(() => undefined),
      ),
    );
  }
}
