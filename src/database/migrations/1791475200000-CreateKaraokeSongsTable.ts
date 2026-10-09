import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaraokeSongsTable1791475200000 implements MigrationInterface {
  name = 'CreateKaraokeSongsTable1791475200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE karaoke_songs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        artist VARCHAR(255) NOT NULL,
        language VARCHAR(60) NOT NULL,
        category VARCHAR(60) NOT NULL,
        youtube_video_id VARCHAR(11)
          CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
        source VARCHAR(100) NOT NULL DEFAULT 'uploaded_catalog',
        is_verified_karaoke TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_youtube_video_id (youtube_video_id),
        INDEX idx_category_language (category, language),
        INDEX idx_artist (artist)
      ) ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
        COLLATE=utf8mb4_unicode_ci
        AUTO_INCREMENT=1001
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE karaoke_songs');
  }
}
