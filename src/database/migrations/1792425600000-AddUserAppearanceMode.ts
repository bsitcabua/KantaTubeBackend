import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAppearanceMode1792425600000 implements MigrationInterface {
  name = 'AddUserAppearanceMode1792425600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE users ADD COLUMN appearanceMode enum('LIGHT','DARK','SYSTEM') NOT NULL DEFAULT 'SYSTEM' AFTER country",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE users DROP COLUMN appearanceMode');
  }
}
