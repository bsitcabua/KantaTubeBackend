import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKaraokePassPayments1792512000000 implements MigrationInterface {
  name = 'CreateKaraokePassPayments1792512000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE karaoke_pass_purchases (
        id char(36) NOT NULL,
        publicReference varchar(20) NOT NULL,
        userId char(36) NOT NULL,
        planCode varchar(16) NOT NULL,
        amountCentavos int unsigned NOT NULL,
        currency char(3) NOT NULL,
        status enum('PENDING','PAID','FAILED','REVIEW','SUPERSEDED') NOT NULL DEFAULT 'PENDING',
        paymongoMode enum('test','live') NOT NULL DEFAULT 'test',
        paymongoPaymentIntentId varchar(255) NULL,
        paymongoPaymentMethodId varchar(255) NULL,
        paymongoPaymentId varchar(255) NULL,
        qrImageUrl text NULL,
        qrExpiresAt datetime NULL,
        paidAt datetime NULL,
        failureReason varchar(255) NULL,
        paymongoStatus varchar(255) NULL,
        activePendingKey varchar(120) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE INDEX uq_karaoke_pass_purchases_public_reference (publicReference),
        UNIQUE INDEX uq_karaoke_pass_purchases_payment_intent (paymongoPaymentIntentId),
        UNIQUE INDEX uq_karaoke_pass_purchases_payment (paymongoPaymentId),
        UNIQUE INDEX uq_karaoke_pass_purchases_pending_key (activePendingKey),
        INDEX idx_karaoke_pass_purchases_user_status (userId, status),
        INDEX idx_karaoke_pass_purchases_qr_expires_at (qrExpiresAt),
        CONSTRAINT fk_karaoke_pass_purchases_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE karaoke_pass_entitlements (
        id char(36) NOT NULL,
        userId char(36) NOT NULL,
        purchaseId char(36) NOT NULL,
        planCode varchar(16) NOT NULL,
        startsAt datetime NOT NULL,
        expiresAt datetime NOT NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE INDEX uq_karaoke_pass_entitlements_purchase (purchaseId),
        INDEX idx_karaoke_pass_entitlements_user_expiry (userId, expiresAt),
        CONSTRAINT fk_karaoke_pass_entitlements_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_karaoke_pass_entitlements_purchase FOREIGN KEY (purchaseId) REFERENCES karaoke_pass_purchases(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`
      CREATE TABLE payment_webhook_events (
        id char(36) NOT NULL,
        eventId varchar(255) NOT NULL,
        eventType varchar(80) NOT NULL,
        paymongoMode enum('test','live') NOT NULL,
        handlingResult varchar(20) NULL,
        processedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE INDEX uq_payment_webhook_events_event_id (eventId)
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE payment_webhook_events');
    await queryRunner.query('DROP TABLE karaoke_pass_entitlements');
    await queryRunner.query('DROP TABLE karaoke_pass_purchases');
  }
}
