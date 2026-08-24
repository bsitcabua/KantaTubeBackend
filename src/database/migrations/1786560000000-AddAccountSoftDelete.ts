import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountSoftDelete1786560000000 implements MigrationInterface {
  name = 'AddAccountSoftDelete1786560000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE users MODIFY COLUMN status enum('active','disabled','deleted') NOT NULL DEFAULT 'active'");
    await queryRunner.query('ALTER TABLE users ADD COLUMN deletedAt datetime NULL AFTER lastLoginAt');
    await queryRunner.query('CREATE INDEX idx_users_deleted_at ON users (deletedAt)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX idx_users_deleted_at ON users');
    await queryRunner.query("UPDATE users SET status = 'disabled' WHERE status = 'deleted'");
    await queryRunner.query('ALTER TABLE users DROP COLUMN deletedAt');
    await queryRunner.query("ALTER TABLE users MODIFY COLUMN status enum('active','disabled') NOT NULL DEFAULT 'active'");
  }
}
