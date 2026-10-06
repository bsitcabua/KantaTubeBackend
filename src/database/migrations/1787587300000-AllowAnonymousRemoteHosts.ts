import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowAnonymousRemoteHosts1787587300000 implements MigrationInterface {
  name = 'AllowAnonymousRemoteHosts1787587300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS karaoke_remote_host_sessions (
        id char(36) NOT NULL,
        tokenHash char(64) NOT NULL,
        expiresAt datetime NOT NULL,
        revokedAt datetime NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX uq_karaoke_remote_host_sessions_token_hash (tokenHash),
        PRIMARY KEY (id)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_pairing_sessions
        MODIFY karaokeSessionId char(36) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_remote_grants
        MODIFY karaokeSessionId char(36) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_pairing_sessions
        ADD remoteHostSessionId char(36) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_remote_grants
        ADD remoteHostSessionId char(36) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_pairing_sessions
        ADD INDEX idx_karaoke_pairing_sessions_guest_active (remoteHostSessionId, consumedAt, expiresAt)
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_remote_grants
        ADD INDEX idx_karaoke_remote_grants_guest_session_status (remoteHostSessionId, status),
        ADD INDEX idx_karaoke_remote_grants_guest_device (remoteHostSessionId, deviceId, status)
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_pairing_sessions
        ADD CONSTRAINT fk_karaoke_pairing_sessions_remote_host
          FOREIGN KEY (remoteHostSessionId) REFERENCES karaoke_remote_host_sessions(id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_remote_grants
        ADD CONSTRAINT fk_karaoke_remote_grants_remote_host
          FOREIGN KEY (remoteHostSessionId) REFERENCES karaoke_remote_host_sessions(id) ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_grants DROP FOREIGN KEY fk_karaoke_remote_grants_remote_host',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_grants DROP INDEX idx_karaoke_remote_grants_guest_device',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_grants DROP INDEX idx_karaoke_remote_grants_guest_session_status',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_grants DROP COLUMN remoteHostSessionId',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_remote_grants MODIFY karaokeSessionId char(36) NOT NULL',
    );

    await queryRunner.query(
      'ALTER TABLE karaoke_pairing_sessions DROP FOREIGN KEY fk_karaoke_pairing_sessions_remote_host',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_pairing_sessions DROP INDEX idx_karaoke_pairing_sessions_guest_active',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_pairing_sessions DROP COLUMN remoteHostSessionId',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_pairing_sessions MODIFY karaokeSessionId char(36) NOT NULL',
    );
    await queryRunner.query('DROP TABLE karaoke_remote_host_sessions');
  }
}
