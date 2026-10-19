import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Immutable snapshot of one completed scored karaoke performance. */
@Entity('karaoke_score_history')
@Index('uq_karaoke_score_history_session_performance', ['sessionId', 'performanceInstanceId'], { unique: true })
@Index('idx_karaoke_score_history_session_id', ['sessionId'])
@Index('idx_karaoke_score_history_session_score', ['sessionId', 'score'])
@Index('idx_karaoke_score_history_session_performer', ['sessionId', 'performerNameSnapshot'])
@Index('idx_karaoke_score_history_completed_at', ['completedAt'])
export class KaraokeScoreHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  sessionId: string;

  @Column({ type: 'char', length: 36 })
  performanceInstanceId: string;

  @Column({ type: 'varchar', length: 60 })
  performerNameSnapshot: string;

  @Column({ type: 'varchar', length: 20 })
  youtubeVideoId: string;

  @Column({ type: 'varchar', length: 200 })
  songTitleSnapshot: string;

  @Column({ type: 'varchar', length: 255 })
  artistSnapshot: string;

  @Column({ type: 'tinyint', unsigned: true })
  score: number;

  @Column({ type: 'varchar', length: 255 })
  scoreMessage: string;

  @Column({ type: 'datetime' })
  completedAt: Date;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;
}
