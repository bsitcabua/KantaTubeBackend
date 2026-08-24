import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('auth_sessions')
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_auth_sessions_token_hash', { unique: true })
  @Column({ type: 'char', length: 64, unique: true })
  tokenHash: string;

  @Index('idx_auth_sessions_user_id')
  @Column({ type: 'char', length: 36 })
  userId: string;

  @Index('idx_auth_sessions_expires_at')
  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime' })
  lastUsedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
