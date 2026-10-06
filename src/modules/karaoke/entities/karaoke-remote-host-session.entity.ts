import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { KaraokePairingSession } from './karaoke-pairing-session.entity';
import { KaraokeRemoteGrant } from './karaoke-remote-grant.entity';

@Entity('karaoke_remote_host_sessions')
@Index('uq_karaoke_remote_host_sessions_token_hash', ['tokenHash'], {
  unique: true,
})
export class KaraokeRemoteHostSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @OneToMany(
    () => KaraokePairingSession,
    (pairing) => pairing.remoteHostSession,
  )
  pairingSessions: KaraokePairingSession[];

  @OneToMany(() => KaraokeRemoteGrant, (grant) => grant.remoteHostSession)
  remoteGrants: KaraokeRemoteGrant[];
}
