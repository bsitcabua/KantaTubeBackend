import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKaraokeCurrentQueueItem1792339200000 implements MigrationInterface {
  name = 'AddKaraokeCurrentQueueItem1792339200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const columns = await queryRunner.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'karaoke_sessions'
        AND COLUMN_NAME = 'currentQueueItemId'
      LIMIT 1
    `);

    if (columns.length === 0) {
      await queryRunner.query(`
        ALTER TABLE karaoke_sessions
          ADD COLUMN currentQueueItemId char(36) NULL
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const columns = await queryRunner.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'karaoke_sessions'
        AND COLUMN_NAME = 'currentQueueItemId'
      LIMIT 1
    `);

    if (columns.length > 0) {
      await queryRunner.query(`
        ALTER TABLE karaoke_sessions
          DROP COLUMN currentQueueItemId
      `);
    }
  }
}
