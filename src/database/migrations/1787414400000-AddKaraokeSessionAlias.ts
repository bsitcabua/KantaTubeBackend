import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKaraokeSessionAlias1787414400000
  implements MigrationInterface
{
  name = 'AddKaraokeSessionAlias1787414400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE karaoke_sessions
      ADD alias varchar(60) NOT NULL DEFAULT 'Karaoke Session' AFTER ownerId
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE karaoke_sessions DROP COLUMN alias
    `);
  }
}
