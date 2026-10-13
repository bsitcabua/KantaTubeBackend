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

@Entity('karaoke_session_performers')
@Index('uq_karaoke_session_performer_position', ['sessionId', 'position'], {
  unique: true,
})
export class KaraokeSessionPerformer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  sessionId: string;

  @Column({ type: 'int', unsigned: true })
  position: number;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => KaraokeSession, (session) => session.performers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session: KaraokeSession;
}
