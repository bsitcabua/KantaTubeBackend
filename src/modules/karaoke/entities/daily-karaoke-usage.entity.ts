import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('daily_karaoke_usage')
@Index('uq_daily_karaoke_usage_user_date', ['userId', 'usageDate'], {
  unique: true,
})
@Index('idx_daily_karaoke_usage_user_id', ['userId'])
export class DailyKaraokeUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'char', length: 36 })
  userId: string;

  @Column({ type: 'date' })
  usageDate: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  usedSeconds: number;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
