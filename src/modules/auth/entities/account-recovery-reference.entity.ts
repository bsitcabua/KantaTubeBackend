import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('account_recovery_references')
export class AccountRecoveryReference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_account_recovery_reference_hash', { unique: true })
  @Column({ type: 'char', length: 64, unique: true })
  referenceHash: string;

  @Index('idx_account_recovery_reference_user_id')
  @Column({ type: 'char', length: 36 })
  userId: string;

  @Index('idx_account_recovery_reference_expires_at')
  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
