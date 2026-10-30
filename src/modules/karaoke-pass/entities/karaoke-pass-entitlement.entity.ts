import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { KaraokePassPurchase } from './karaoke-pass-purchase.entity';

@Entity('karaoke_pass_entitlements')
@Index('uq_karaoke_pass_entitlements_purchase', ['purchaseId'], {
  unique: true,
})
@Index('idx_karaoke_pass_entitlements_user_expiry', ['userId', 'expiresAt'])
export class KaraokePassEntitlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  userId: string;

  @Column({ type: 'char', length: 36 })
  purchaseId: string;

  @Column({ type: 'varchar', length: 16 })
  planCode: string;

  @Column({ type: 'datetime' })
  startsAt: Date;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @OneToOne(() => KaraokePassPurchase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchaseId' })
  purchase: KaraokePassPurchase;
}
