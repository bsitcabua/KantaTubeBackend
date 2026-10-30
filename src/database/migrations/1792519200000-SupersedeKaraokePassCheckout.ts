import { MigrationInterface, QueryRunner } from 'typeorm';

export class SupersedeKaraokePassCheckout1792519200000
  implements MigrationInterface
{
  name = 'SupersedeKaraokePassCheckout1792519200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE karaoke_pass_purchases MODIFY COLUMN status enum('PENDING','PAID','FAILED','REVIEW','SUPERSEDED') NOT NULL DEFAULT 'PENDING'",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE karaoke_pass_purchases SET status = 'REVIEW', failureReason = 'Superseded checkout requires review before rollback.' WHERE status = 'SUPERSEDED'",
    );
    await queryRunner.query(
      "ALTER TABLE karaoke_pass_purchases MODIFY COLUMN status enum('PENDING','PAID','FAILED','REVIEW') NOT NULL DEFAULT 'PENDING'",
    );
  }
}
