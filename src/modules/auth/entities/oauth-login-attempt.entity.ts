import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthProvider } from './auth-account.entity';

@Entity('oauth_login_attempts')
export class OAuthLoginAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_oauth_attempts_state_hash', { unique: true })
  @Column({ type: 'char', length: 64, unique: true })
  stateHash: string;

  @Column({ type: 'enum', enum: AuthProvider })
  provider: AuthProvider;

  @Column({ type: 'varchar', length: 128 })
  codeVerifier: string;

  @Column({ type: 'varchar', length: 2048 })
  returnPath: string;

  @Index('idx_oauth_attempts_expires_at')
  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
