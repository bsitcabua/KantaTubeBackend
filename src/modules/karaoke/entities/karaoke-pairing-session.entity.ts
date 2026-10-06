import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { KaraokeSession } from './karaoke-session.entity';
import { KaraokeRemoteHostSession } from './karaoke-remote-host-session.entity';

@Entity('karaoke_pairing_sessions')
@Index('idx_karaoke_pairing_sessions_session_active', [
  'karaokeSessionId',
  'consumedAt',
  'expiresAt',
])
@Index('idx_karaoke_pairing_sessions_guest_active', [
  'remoteHostSessionId',
  'consumedAt',
  'expiresAt',
])
@Index('uq_karaoke_pairing_sessions_token_hash', ['tokenHash'], {
  unique: true,
})
export class KaraokePairingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36, nullable: true })
  karaokeSessionId: string | null;

  @Column({ type: 'char', length: 36, nullable: true })
  remoteHostSessionId: string | null;

  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @ManyToOne(() => KaraokeSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'karaokeSessionId' })
  karaokeSession: KaraokeSession;

  @ManyToOne(() => KaraokeRemoteHostSession, (host) => host.pairingSessions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'remoteHostSessionId' })
  remoteHostSession: KaraokeRemoteHostSession;
}
