import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum PasswordOtpPurpose {
  RESET = 'password_reset',
  CHANGE = 'password_change',
  ACCOUNT_DELETION = 'account_deletion',
  ACCOUNT_RECOVERY = 'account_recovery',
}

@Entity('password_otp_codes')
export class PasswordOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_password_otp_user_id')
  @Column({ type: 'char', length: 36, nullable: true })
  userId: string | null;

  @Index('idx_password_otp_email')
  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({ type: 'varchar', length: 32 })
  purpose: PasswordOtpPurpose;

  @Column({ type: 'char', length: 64 })
  codeHash: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'char', length: 64, nullable: true })
  verificationTokenHash: string | null;

  @Column({ type: 'datetime', nullable: true })
  verificationTokenExpiresAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
