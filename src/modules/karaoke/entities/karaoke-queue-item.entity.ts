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

@Entity('karaoke_queue_items')
@Index('uq_karaoke_queue_session_position', ['sessionId', 'position'], {
  unique: true,
})
export class KaraokeQueueItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  sessionId: string;

  @Column({ type: 'int', unsigned: true })
  position: number;

  @Column({ type: 'varchar', length: 20 })
  videoId: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 1000, default: '' })
  description: string;

  @Column({ type: 'varchar', length: 2048 })
  thumbnails: string;

  @Column({ type: 'varchar', length: 60 })
  performer: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @ManyToOne(() => KaraokeSession, (session) => session.queueItems, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session: KaraokeSession;
}
