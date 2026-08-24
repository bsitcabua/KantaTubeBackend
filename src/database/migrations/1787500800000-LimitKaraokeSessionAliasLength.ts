import { MigrationInterface, QueryRunner } from 'typeorm';

export class LimitKaraokeSessionAliasLength1787500800000
  implements MigrationInterface
{
  name = 'LimitKaraokeSessionAliasLength1787500800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE karaoke_sessions
      SET alias = LEFT(alias, 20)
      WHERE CHAR_LENGTH(alias) > 20
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_sessions MODIFY alias varchar(20) NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE karaoke_sessions MODIFY alias varchar(60) NOT NULL
    `);
  }
}
