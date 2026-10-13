import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRemoteDisplayName1791993600000 implements MigrationInterface {
  name = 'AddRemoteDisplayName1791993600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE karaoke_remote_grants
        ADD displayName varchar(30) NULL AFTER deviceId
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_grants DROP COLUMN displayName',
    );
  }
}
