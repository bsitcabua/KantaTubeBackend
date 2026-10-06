import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaraokeRemoteAuthorization1787587200000
  implements MigrationInterface
{
  name = 'CreateKaraokeRemoteAuthorization1787587200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE karaoke_pairing_sessions (
        id char(36) NOT NULL,
        karaokeSessionId char(36) NOT NULL,
        tokenHash char(64) NOT NULL,
        expiresAt datetime NOT NULL,
        consumedAt datetime NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX idx_karaoke_pairing_sessions_session_active (karaokeSessionId, consumedAt, expiresAt),
        UNIQUE INDEX uq_karaoke_pairing_sessions_token_hash (tokenHash),
        PRIMARY KEY (id),
        CONSTRAINT fk_karaoke_pairing_sessions_session FOREIGN KEY (karaokeSessionId) REFERENCES karaoke_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE karaoke_remote_grants (
        id char(36) NOT NULL,
        karaokeSessionId char(36) NOT NULL,
        deviceId char(36) NOT NULL,
        deviceLabel varchar(100) NOT NULL,
        status enum('pending','approved','rejected','revoked','expired','disconnected') NOT NULL DEFAULT 'pending',
        grantTokenHash char(64) NULL,
        expiresAt datetime NOT NULL,
        approvedAt datetime NULL,
        revokedAt datetime NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_karaoke_remote_grants_session_status (karaokeSessionId, status),
        INDEX idx_karaoke_remote_grants_device (karaokeSessionId, deviceId, status),
        UNIQUE INDEX idx_karaoke_remote_grants_token_hash (grantTokenHash),
        PRIMARY KEY (id),
        CONSTRAINT fk_karaoke_remote_grants_session FOREIGN KEY (karaokeSessionId) REFERENCES karaoke_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE karaoke_remote_grants');
    await queryRunner.query('DROP TABLE karaoke_pairing_sessions');
  }
}
