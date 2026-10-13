import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaraokeLibraryTables1791561600000 implements MigrationInterface {
  name = 'CreateKaraokeLibraryTables1791561600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE karaoke_favorites (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        source_type enum('songbook','youtube') NOT NULL,
        songbook_song_id INT UNSIGNED NULL,
        youtube_video_id varchar(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
        title varchar(255) NOT NULL,
        artist varchar(255) NULL,
        thumbnail_url varchar(2048) NULL,
        dedupe_key varchar(80) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX idx_karaoke_favorites_user_id (user_id),
        INDEX idx_karaoke_favorites_user_created_at (user_id, created_at),
        UNIQUE INDEX uq_karaoke_favorites_user_dedupe_key (user_id, dedupe_key),
        CONSTRAINT fk_karaoke_favorites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_karaoke_favorites_songbook_song FOREIGN KEY (songbook_song_id) REFERENCES karaoke_songs(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE karaoke_playlists (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        name varchar(80) NOT NULL,
        normalized_name varchar(80) NOT NULL,
        description varchar(500) NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX idx_karaoke_playlists_user_id (user_id),
        INDEX idx_karaoke_playlists_user_updated_at (user_id, updated_at),
        UNIQUE INDEX uq_karaoke_playlists_user_normalized_name (user_id, normalized_name),
        CONSTRAINT fk_karaoke_playlists_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE karaoke_playlist_items (
        id char(36) NOT NULL,
        playlist_id char(36) NOT NULL,
        source_type enum('songbook','youtube') NOT NULL,
        songbook_song_id INT UNSIGNED NULL,
        youtube_video_id varchar(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
        title varchar(255) NOT NULL,
        artist varchar(255) NULL,
        description varchar(1000) NULL,
        thumbnail_url varchar(2048) NULL,
        position INT UNSIGNED NOT NULL,
        dedupe_key varchar(80) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX idx_karaoke_playlist_items_playlist_id (playlist_id),
        INDEX idx_karaoke_playlist_items_playlist_position (playlist_id, position),
        UNIQUE INDEX uq_karaoke_playlist_items_playlist_dedupe_key (playlist_id, dedupe_key),
        CONSTRAINT fk_karaoke_playlist_items_playlist FOREIGN KEY (playlist_id) REFERENCES karaoke_playlists(id) ON DELETE CASCADE,
        CONSTRAINT fk_karaoke_playlist_items_songbook_song FOREIGN KEY (songbook_song_id) REFERENCES karaoke_songs(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE karaoke_playlist_items');
    await queryRunner.query('DROP TABLE karaoke_playlists');
    await queryRunner.query('DROP TABLE karaoke_favorites');
  }
}
