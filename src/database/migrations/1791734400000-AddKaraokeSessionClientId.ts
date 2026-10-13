import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKaraokeSessionClientId1791734400000
  implements MigrationInterface
{
  name = 'AddKaraokeSessionClientId1791734400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE karaoke_sessions ADD COLUMN clientId char(36) NULL AFTER leaseExpiresAt',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE karaoke_sessions DROP COLUMN clientId',
    );
  }
}
