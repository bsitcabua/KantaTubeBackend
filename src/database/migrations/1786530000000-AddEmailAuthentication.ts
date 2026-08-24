import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailAuthentication1786530000000 implements MigrationInterface {
  name = 'AddEmailAuthentication1786530000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE users ADD COLUMN passwordHash varchar(255) NULL AFTER emailVerified',
    );
    await queryRunner.query(`
      CREATE TABLE email_verification_codes (
        id char(36) NOT NULL,
        email varchar(254) NOT NULL,
        codeHash char(64) NOT NULL,
        expiresAt datetime NOT NULL,
        usedAt datetime NULL,
        attempts int NOT NULL DEFAULT 0,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX idx_email_verification_email (email),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE email_verification_codes');
    await queryRunner.query('ALTER TABLE users DROP COLUMN passwordHash');
  }
}
