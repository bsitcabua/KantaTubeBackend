import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthenticationTables1786521600000 implements MigrationInterface {
  name = 'CreateAuthenticationTables1786521600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id char(36) NOT NULL,
        displayName varchar(150) NOT NULL,
        email varchar(254) NULL,
        emailVerified tinyint NOT NULL DEFAULT 0,
        avatarUrl varchar(2048) NULL,
        status enum('active','disabled') NOT NULL DEFAULT 'active',
        lastLoginAt datetime NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_users_email (email),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE auth_accounts (
        id char(36) NOT NULL,
        userId char(36) NOT NULL,
        provider enum('google','facebook') NOT NULL,
        providerUserId varchar(255) NOT NULL,
        providerEmail varchar(254) NULL,
        providerDisplayName varchar(150) NULL,
        providerAvatarUrl varchar(2048) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_auth_accounts_user_id (userId),
        UNIQUE INDEX uq_auth_accounts_provider_identity (provider, providerUserId),
        PRIMARY KEY (id),
        CONSTRAINT fk_auth_accounts_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE auth_sessions (
        id char(36) NOT NULL,
        tokenHash char(64) NOT NULL,
        userId char(36) NOT NULL,
        expiresAt datetime NOT NULL,
        lastUsedAt datetime NOT NULL,
        revokedAt datetime NULL,
        userAgent varchar(500) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX idx_auth_sessions_token_hash (tokenHash),
        INDEX idx_auth_sessions_user_id (userId),
        INDEX idx_auth_sessions_expires_at (expiresAt),
        PRIMARY KEY (id),
        CONSTRAINT fk_auth_sessions_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE oauth_login_attempts (
        id char(36) NOT NULL,
        stateHash char(64) NOT NULL,
        provider enum('google','facebook') NOT NULL,
        codeVerifier varchar(128) NOT NULL,
        returnPath varchar(2048) NOT NULL,
        expiresAt datetime NOT NULL,
        usedAt datetime NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX idx_oauth_attempts_state_hash (stateHash),
        INDEX idx_oauth_attempts_expires_at (expiresAt),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE oauth_login_attempts');
    await queryRunner.query('DROP TABLE auth_sessions');
    await queryRunner.query('DROP TABLE auth_accounts');
    await queryRunner.query('DROP TABLE users');
  }
}
