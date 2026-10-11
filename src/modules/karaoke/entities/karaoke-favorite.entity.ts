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
import { User } from '../../users/entities/user.entity';
import { KaraokeSong } from './karaoke-song.entity';

export enum KaraokeFavoriteSourceType {
  SONGBOOK = 'songbook',
  YOUTUBE = 'youtube',
}

@Entity('karaoke_favorites')
@Index('idx_karaoke_favorites_user_id', ['userId'])
@Index('idx_karaoke_favorites_user_created_at', ['userId', 'createdAt'])
@Index('uq_karaoke_favorites_user_dedupe_key', ['userId', 'dedupeKey'], {
  unique: true,
})
export class KaraokeFavorite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ name: 'source_type', type: 'enum', enum: KaraokeFavoriteSourceType })
  sourceType: KaraokeFavoriteSourceType;

  @Column({ name: 'songbook_song_id', type: 'int', unsigned: true, nullable: true })
  songbookSongId: number | null;

  @Column({
    name: 'youtube_video_id',
    type: 'varchar',
    length: 20,
    nullable: true,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  youtubeVideoId: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  artist: string | null;

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 2048, nullable: true })
  thumbnailUrl: string | null;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 80 })
  dedupeKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => KaraokeSong, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'songbook_song_id' })
  songbookSong: KaraokeSong | null;
}
