import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { KaraokeQueueItem } from './karaoke-queue-item.entity';
import { KaraokeSessionPerformer } from './karaoke-session-performer.entity';

export enum KaraokeSessionStatus {
  ACTIVE = 'active',
  LOCKED_QUOTA = 'locked_quota',
  ENDED = 'ended',
  EXPIRED = 'expired',
}

@Entity('karaoke_sessions')
@Index('idx_karaoke_sessions_owner_status_lease', [
  'ownerId',
  'status',
  'leaseExpiresAt',
])
export class KaraokeSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  ownerId: string;

  @Column({ type: 'varchar', length: 20 })
  alias: string;

  @Column({ type: 'date', nullable: true })
  sessionDay: string | null;

  @Column({
    type: 'enum',
    enum: KaraokeSessionStatus,
    default: KaraokeSessionStatus.ACTIVE,
  })
  status: KaraokeSessionStatus;

  @Column({ type: 'datetime' })
  lastHeartbeatAt: Date;

  @Index('idx_karaoke_sessions_lease_expires_at')
  @Column({ type: 'datetime' })
  leaseExpiresAt: Date;

  @Column({ type: 'char', length: 36, nullable: true })
  clientId: string | null;

  @Column({ type: 'datetime', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  hasStartedSong: boolean;

  @Column({ type: 'datetime', nullable: true })
  firstSongStartedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  currentSongActive: boolean;

  @Column({ type: 'char', length: 36, nullable: true })
  currentQueueItemId: string | null;

  @Column({ type: 'boolean', default: false })
  quotaExhaustionPending: boolean;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.karaokeSessions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @OneToMany(() => KaraokeQueueItem, (item) => item.session)
  queueItems: KaraokeQueueItem[];

  @OneToMany(() => KaraokeSessionPerformer, (performer) => performer.session)
  performers: KaraokeSessionPerformer[];
}
