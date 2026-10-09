import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('karaoke_songs')
@Index('uq_youtube_video_id', ['youtubeVideoId'], { unique: true })
@Index('idx_category_language', ['category', 'language'])
@Index('idx_artist', ['artist'])
export class KaraokeSong {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  artist: string;

  @Column({ type: 'varchar', length: 60 })
  language: string;

  @Column({ type: 'varchar', length: 60 })
  category: string;

  @Column({
    name: 'youtube_video_id',
    type: 'varchar',
    length: 11,
    nullable: true,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  youtubeVideoId: string | null;

  @Column({
    type: 'varchar',
    length: 100,
    default: 'uploaded_catalog',
  })
  source: string;

  @Column({ name: 'is_verified_karaoke', type: 'boolean', default: false })
  isVerifiedKaraoke: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
