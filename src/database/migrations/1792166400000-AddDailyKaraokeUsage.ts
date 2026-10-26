import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyKaraokeUsage1792166400000 implements MigrationInterface {
  name = 'AddDailyKaraokeUsage1792166400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE karaoke_sessions
        MODIFY status enum('active','locked_quota','ended','expired') NOT NULL DEFAULT 'active',
        ADD COLUMN sessionDay date NULL,
        ADD COLUMN hasStartedSong tinyint(1) NOT NULL DEFAULT 0,
        ADD COLUMN firstSongStartedAt datetime NULL,
        ADD COLUMN currentSongActive tinyint(1) NOT NULL DEFAULT 0,
        ADD COLUMN quotaExhaustionPending tinyint(1) NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE karaoke_sessions
        ADD INDEX idx_karaoke_sessions_owner_status_day (ownerId, status, sessionDay)
    `);

    await queryRunner.query(`
      CREATE TABLE daily_karaoke_usage (
        id char(36) NOT NULL,
        userId char(36) NOT NULL,
        usageDate date NOT NULL,
        usedSeconds int unsigned NOT NULL DEFAULT 0,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX uq_daily_karaoke_usage_user_date (userId, usageDate),
        INDEX idx_daily_karaoke_usage_user_id (userId),
        PRIMARY KEY (id),
        CONSTRAINT fk_daily_karaoke_usage_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // Keep pre-allowance sessions that already have immutable score records in
    // account history. New empty sessions remain excluded by the service.
    await queryRunner.query(`
      UPDATE karaoke_sessions
      SET hasStartedSong = 1,
          firstSongStartedAt = COALESCE(firstSongStartedAt, createdAt)
      WHERE status IN ('ended', 'expired')
        AND EXISTS (
          SELECT 1
          FROM karaoke_score_history AS scores
          WHERE scores.sessionId = karaoke_sessions.id
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE daily_karaoke_usage');
    await queryRunner.query(`
      ALTER TABLE karaoke_sessions
        DROP INDEX idx_karaoke_sessions_owner_status_day,
        DROP COLUMN quotaExhaustionPending,
        DROP COLUMN currentSongActive,
        DROP COLUMN firstSongStartedAt,
        DROP COLUMN hasStartedSong,
        DROP COLUMN sessionDay,
        MODIFY status enum('active','ended','expired') NOT NULL DEFAULT 'active'
    `);
  }
}
