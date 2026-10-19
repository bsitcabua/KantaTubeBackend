import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaraokeScoreHistory1792080000000 implements MigrationInterface {
  name = 'CreateKaraokeScoreHistory1792080000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE karaoke_score_history (
        id char(36) NOT NULL,
        sessionId char(36) NOT NULL,
        performanceInstanceId char(36) NOT NULL,
        performerNameSnapshot varchar(60) NOT NULL,
        youtubeVideoId varchar(20) NOT NULL,
        songTitleSnapshot varchar(200) NOT NULL,
        artistSnapshot varchar(255) NOT NULL,
        score tinyint unsigned NOT NULL,
        scoreMessage varchar(255) NOT NULL,
        completedAt datetime NOT NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX uq_karaoke_score_history_session_performance (sessionId, performanceInstanceId),
        INDEX idx_karaoke_score_history_session_id (sessionId),
        INDEX idx_karaoke_score_history_session_score (sessionId, score),
        INDEX idx_karaoke_score_history_session_performer (sessionId, performerNameSnapshot),
        INDEX idx_karaoke_score_history_completed_at (completedAt),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE karaoke_score_history');
  }
}
