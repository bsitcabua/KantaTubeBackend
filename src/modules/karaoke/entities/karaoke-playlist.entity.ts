import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { KaraokePlaylistItem } from './karaoke-playlist-item.entity';
import { KaraokeLibraryVisibility } from '../karaoke-library-visibility';

@Entity('karaoke_playlists')
@Index('idx_karaoke_playlists_user_id', ['userId'])
@Index('idx_karaoke_playlists_user_updated_at', ['userId', 'updatedAt'])
@Index('uq_karaoke_playlists_user_normalized_name', ['userId', 'normalizedName'], {
  unique: true,
})
export class KaraokePlaylist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ name: 'normalized_name', type: 'varchar', length: 80 })
  normalizedName: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: KaraokeLibraryVisibility,
    default: KaraokeLibraryVisibility.PRIVATE,
  })
  visibility: KaraokeLibraryVisibility;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => KaraokePlaylistItem, (item) => item.playlist)
  items: KaraokePlaylistItem[];
}
