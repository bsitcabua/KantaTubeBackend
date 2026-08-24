import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaraokeSessions1787241600000 implements MigrationInterface {
  name = 'CreateKaraokeSessions1787241600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE karaoke_sessions (
        id char(36) NOT NULL,
        ownerId char(36) NOT NULL,
        status enum('active','ended','expired') NOT NULL DEFAULT 'active',
        lastHeartbeatAt datetime NOT NULL,
        leaseExpiresAt datetime NOT NULL,
        endedAt datetime NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_karaoke_sessions_owner_status_lease (ownerId, status, leaseExpiresAt),
        INDEX idx_karaoke_sessions_lease_expires_at (leaseExpiresAt),
        PRIMARY KEY (id),
        CONSTRAINT fk_karaoke_sessions_owner FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE karaoke_sessions');
  }
}
