import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('email_verification_codes')
export class EmailVerificationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_email_verification_email')
  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({ type: 'char', length: 64 })
  codeHash: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
