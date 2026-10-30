import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('payment_webhook_events')
@Index('uq_payment_webhook_events_event_id', ['eventId'], { unique: true })
export class PaymentWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  eventId: string;

  @Column({ type: 'varchar', length: 80 })
  eventType: string;

  @Column({ type: 'enum', enum: ['test', 'live'] })
  paymongoMode: 'test' | 'live';

  @Column({ type: 'varchar', length: 20, nullable: true })
  handlingResult: string | null;

  @CreateDateColumn({ type: 'datetime' })
  processedAt: Date;
}
