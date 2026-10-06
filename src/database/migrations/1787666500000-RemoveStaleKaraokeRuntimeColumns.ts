import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes columns left behind by the reverted Phase 3 karaoke runtime schema.
 *
 * The current karaoke flow does not use these fields. Keeping them as required
 * columns makes otherwise valid session inserts fail on databases where the
 * Phase 3 migration was previously applied.
 */
export class RemoveStaleKaraokeRuntimeColumns1787666500000
  implements MigrationInterface
{
  name = 'RemoveStaleKaraokeRuntimeColumns1787666500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const columnName of ['performers', 'revision', 'playbackState']) {
      const table = await queryRunner.getTable('karaoke_sessions');

      if (table?.findColumnByName(columnName)) {
        await queryRunner.dropColumn('karaoke_sessions', columnName);
      }
    }
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // These columns belonged to the reverted Phase 3 runtime and are
    // intentionally not restored when this cleanup migration is reverted.
  }
}
