import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserProfileFields1786550000000 implements MigrationInterface {
  name = 'AddUserProfileFields1786550000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE users ADD COLUMN phoneNumber varchar(30) NULL AFTER avatarUrl');
    await queryRunner.query('ALTER TABLE users ADD COLUMN addressLine varchar(255) NULL AFTER phoneNumber');
    await queryRunner.query('ALTER TABLE users ADD COLUMN city varchar(150) NULL AFTER addressLine');
    await queryRunner.query('ALTER TABLE users ADD COLUMN province varchar(150) NULL AFTER city');
    await queryRunner.query('ALTER TABLE users ADD COLUMN postalCode varchar(30) NULL AFTER province');
    await queryRunner.query('ALTER TABLE users ADD COLUMN country varchar(100) NULL AFTER postalCode');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE users DROP COLUMN country, DROP COLUMN postalCode, DROP COLUMN province, DROP COLUMN city, DROP COLUMN addressLine, DROP COLUMN phoneNumber');
  }
}
