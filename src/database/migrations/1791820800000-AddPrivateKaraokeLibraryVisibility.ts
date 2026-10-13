import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrivateKaraokeLibraryVisibility1791820800000
  implements MigrationInterface
{
  name = 'AddPrivateKaraokeLibraryVisibility1791820800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE karaoke_favorites
        ADD visibility enum('private','public') NOT NULL DEFAULT 'private'
    `);
    await queryRunner.query(`
      ALTER TABLE karaoke_playlists
        ADD visibility enum('private','public') NOT NULL DEFAULT 'private'
    `);

    // Existing rows are deliberately private. No legacy library content is
    // exposed to connected Remotes by this migration.
    await queryRunner.query(`
      UPDATE karaoke_favorites SET visibility = 'private'
    `);
    await queryRunner.query(`
      UPDATE karaoke_playlists SET visibility = 'private'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE karaoke_playlists DROP COLUMN visibility',
    );
    await queryRunner.query(
      'ALTER TABLE karaoke_favorites DROP COLUMN visibility',
    );
  }
}
