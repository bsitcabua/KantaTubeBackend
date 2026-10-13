import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaraokeSessionPerformers1791648000000
  implements MigrationInterface
{
  name = 'CreateKaraokeSessionPerformers1791648000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE karaoke_session_performers (
        id char(36) NOT NULL,
        sessionId char(36) NOT NULL,
        position int unsigned NOT NULL,
        name varchar(60) NOT NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX uq_karaoke_session_performer_position (sessionId, position),
        INDEX idx_karaoke_session_performer_session_id (sessionId),
        PRIMARY KEY (id),
        CONSTRAINT fk_karaoke_session_performer_session FOREIGN KEY (sessionId) REFERENCES karaoke_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE karaoke_session_performers');
  }
}
