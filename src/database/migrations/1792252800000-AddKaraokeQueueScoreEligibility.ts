import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKaraokeQueueScoreEligibility1792252800000
  implements MigrationInterface
{
  name = 'AddKaraokeQueueScoreEligibility1792252800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const columns = await queryRunner.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'karaoke_queue_items'
        AND COLUMN_NAME = 'scoreEligible'
      LIMIT 1
    `);

    if (columns.length === 0) {
      await queryRunner.query(`
        ALTER TABLE karaoke_queue_items
          ADD COLUMN scoreEligible tinyint(1) NOT NULL DEFAULT 0
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const columns = await queryRunner.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'karaoke_queue_items'
        AND COLUMN_NAME = 'scoreEligible'
      LIMIT 1
    `);

    if (columns.length > 0) {
      await queryRunner.query(`
        ALTER TABLE karaoke_queue_items
          DROP COLUMN scoreEligible
      `);
    }
  }
}
