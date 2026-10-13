import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClaimGuestKaraokeSessions1791907200000
  implements MigrationInterface
{
  name = 'ClaimGuestKaraokeSessions1791907200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Keep the index in a separate ALTER. Some MySQL-compatible deployments
    // resolve an index definition before columns from the same ALTER are
    // available, which makes the combined statement fail with
    // ER_KEY_COLUMN_DOES_NOT_EXITS.
    await queryRunner.query(`
      ALTER TABLE karaoke_remote_host_sessions
        ADD claimedOwnerId char(36) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_remote_host_sessions
        ADD claimedAt datetime NULL
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_remote_host_sessions
        ADD INDEX idx_karaoke_remote_host_sessions_claimed_owner (claimedOwnerId)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_host_sessions DROP INDEX idx_karaoke_remote_host_sessions_claimed_owner',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_host_sessions DROP COLUMN claimedAt',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_host_sessions DROP COLUMN claimedOwnerId',
    );
  }
}
