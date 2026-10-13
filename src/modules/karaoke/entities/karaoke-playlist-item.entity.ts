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
import { KaraokeSong } from './karaoke-song.entity';
import { KaraokePlaylist } from './karaoke-playlist.entity';
import { KaraokeFavoriteSourceType } from './karaoke-favorite.entity';

@Entity('karaoke_playlist_items')
@Index('idx_karaoke_playlist_items_playlist_id', ['playlistId'])
@Index('idx_karaoke_playlist_items_playlist_position', ['playlistId', 'position'])
@Index('uq_karaoke_playlist_items_playlist_dedupe_key', ['playlistId', 'dedupeKey'], {
  unique: true,
})
export class KaraokePlaylistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'playlist_id', type: 'char', length: 36 })
  playlistId: string;

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

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @Column({ name: 'thumbnail_url', type: 'varchar', length: 2048, nullable: true })
  thumbnailUrl: string | null;

  @Column({ type: 'int', unsigned: true })
  position: number;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 80 })
  dedupeKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => KaraokePlaylist, (playlist) => playlist.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'playlist_id' })
  playlist: KaraokePlaylist;

  @ManyToOne(() => KaraokeSong, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'songbook_song_id' })
  songbookSong: KaraokeSong | null;
}
