import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum KaraokePassPurchaseStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REVIEW = 'REVIEW',
  SUPERSEDED = 'SUPERSEDED',
}

export type KaraokePassPaymentMode = 'test' | 'live';

@Entity('karaoke_pass_purchases')
@Index('uq_karaoke_pass_purchases_public_reference', ['publicReference'], {
  unique: true,
})
@Index(
  'uq_karaoke_pass_purchases_payment_intent',
  ['paymongoPaymentIntentId'],
  { unique: true },
)
@Index('uq_karaoke_pass_purchases_payment', ['paymongoPaymentId'], {
  unique: true,
})
@Index('uq_karaoke_pass_purchases_pending_key', ['activePendingKey'], {
  unique: true,
})
@Index('idx_karaoke_pass_purchases_user_status', ['userId', 'status'])
@Index('idx_karaoke_pass_purchases_qr_expires_at', ['qrExpiresAt'])
export class KaraokePassPurchase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  publicReference: string;

  @Column({ type: 'char', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  planCode: string;

  @Column({ type: 'int', unsigned: true })
  amountCentavos: number;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({
    type: 'enum',
    enum: KaraokePassPurchaseStatus,
    default: KaraokePassPurchaseStatus.PENDING,
  })
  status: KaraokePassPurchaseStatus;

  @Column({ type: 'enum', enum: ['test', 'live'], default: 'test' })
  paymongoMode: KaraokePassPaymentMode;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymongoPaymentIntentId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymongoPaymentMethodId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymongoPaymentId: string | null;

  @Column({ type: 'text', nullable: true })
  qrImageUrl: string | null;

  @Column({ type: 'text', nullable: true })
  testUrl: string | null;

  @Column({ type: 'datetime', nullable: true })
  qrExpiresAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  failureReason: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymongoStatus: string | null;

  /** Non-secret server-side idempotency discriminator for the pending row. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  activePendingKey: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
