import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountRecovery1786646400000 implements MigrationInterface {
  name = 'AddAccountRecovery1786646400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE users ADD COLUMN scheduledDeletionAt datetime NULL AFTER deletedAt',
    );
    await queryRunner.query(
      'CREATE INDEX idx_users_scheduled_deletion_at ON users (scheduledDeletionAt)',
    );
    await queryRunner.query(
      "UPDATE users SET scheduledDeletionAt = DATE_ADD(deletedAt, INTERVAL 30 DAY) WHERE status = 'deleted' AND deletedAt IS NOT NULL",
    );
    await queryRunner.query(`
      CREATE TABLE account_recovery_references (
        id char(36) NOT NULL,
        referenceHash char(64) NOT NULL,
        userId char(36) NOT NULL,
        expiresAt datetime NOT NULL,
        usedAt datetime NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE INDEX idx_account_recovery_reference_hash (referenceHash),
        INDEX idx_account_recovery_reference_user_id (userId),
        INDEX idx_account_recovery_reference_expires_at (expiresAt),
        CONSTRAINT fk_account_recovery_reference_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE account_recovery_references');
    await queryRunner.query(
      'DROP INDEX idx_users_scheduled_deletion_at ON users',
    );
    await queryRunner.query(
      'ALTER TABLE users DROP COLUMN scheduledDeletionAt',
    );
  }
}
