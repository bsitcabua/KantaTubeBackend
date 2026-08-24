import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordOtp1786540000000 implements MigrationInterface {
  name = 'AddPasswordOtp1786540000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE password_otp_codes (
        id char(36) NOT NULL,
        userId char(36) NULL,
        email varchar(254) NOT NULL,
        purpose varchar(32) NOT NULL,
        codeHash char(64) NOT NULL,
        expiresAt datetime NOT NULL,
        usedAt datetime NULL,
        attempts int NOT NULL DEFAULT 0,
        verificationTokenHash char(64) NULL,
        verificationTokenExpiresAt datetime NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX idx_password_otp_user_id (userId),
        INDEX idx_password_otp_email (email),
        INDEX idx_password_otp_token (verificationTokenHash),
        PRIMARY KEY (id),
        CONSTRAINT fk_password_otp_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE password_otp_codes');
  }
}
