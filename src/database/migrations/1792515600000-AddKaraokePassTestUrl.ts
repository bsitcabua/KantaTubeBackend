import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKaraokePassTestUrl1792515600000
  implements MigrationInterface
{
  name = 'AddKaraokePassTestUrl1792515600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE karaoke_pass_purchases ADD COLUMN testUrl text NULL AFTER qrImageUrl',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE karaoke_pass_purchases DROP COLUMN testUrl',
    );
  }
}
