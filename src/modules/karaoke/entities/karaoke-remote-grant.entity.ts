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
import { KaraokeSession } from './karaoke-session.entity';
import { KaraokeRemoteHostSession } from './karaoke-remote-host-session.entity';

export enum KaraokeRemoteGrantStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
  DISCONNECTED = 'disconnected',
}

@Entity('karaoke_remote_grants')
@Index('idx_karaoke_remote_grants_session_status', [
  'karaokeSessionId',
  'status',
])
@Index('idx_karaoke_remote_grants_device', [
  'karaokeSessionId',
  'deviceId',
  'status',
])
@Index('idx_karaoke_remote_grants_guest_session_status', [
  'remoteHostSessionId',
  'status',
])
@Index('idx_karaoke_remote_grants_guest_device', [
  'remoteHostSessionId',
  'deviceId',
  'status',
])
@Index('idx_karaoke_remote_grants_token_hash', ['grantTokenHash'], {
  unique: true,
})
export class KaraokeRemoteGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36, nullable: true })
  karaokeSessionId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  remoteHostSessionId: string | null;

  @Column({ type: 'char', length: 36 })
  deviceId: string;

  @Column({ type: 'varchar', length: 100 })
  deviceLabel: string;

  @Column({
    type: 'enum',
    enum: KaraokeRemoteGrantStatus,
    default: KaraokeRemoteGrantStatus.PENDING,
  })
  status: KaraokeRemoteGrantStatus;

  @Column({ type: 'char', length: 64, nullable: true })
  grantTokenHash: string | null;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => KaraokeSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'karaokeSessionId' })
  karaokeSession: KaraokeSession;

  @ManyToOne(() => KaraokeRemoteHostSession, (host) => host.remoteGrants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'remoteHostSessionId' })
  remoteHostSession: KaraokeRemoteHostSession;
}
