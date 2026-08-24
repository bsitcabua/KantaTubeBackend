import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaraokeQueueItems1787328000000
  implements MigrationInterface
{
  name = 'CreateKaraokeQueueItems1787328000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE karaoke_queue_items (
        id char(36) NOT NULL,
        sessionId char(36) NOT NULL,
        position int unsigned NOT NULL,
        videoId varchar(20) NOT NULL,
        title varchar(200) NOT NULL,
        description varchar(1000) NOT NULL DEFAULT '',
        thumbnails varchar(2048) NOT NULL,
        performer varchar(60) NOT NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX uq_karaoke_queue_session_position (sessionId, position),
        INDEX idx_karaoke_queue_session_id (sessionId),
        PRIMARY KEY (id),
        CONSTRAINT fk_karaoke_queue_session FOREIGN KEY (sessionId) REFERENCES karaoke_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE karaoke_queue_items');
  }
}
