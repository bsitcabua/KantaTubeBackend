import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureUserEmailIndex1786732800000 implements MigrationInterface {
  name = 'EnsureUserEmailIndex1786732800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const usersTable = await queryRunner.getTable('users');
    if (!usersTable?.indices.some((index) => index.name === 'idx_users_email')) {
      await queryRunner.query('CREATE INDEX idx_users_email ON users (email)');
    }
  }

  // This index predates the repair migration, so reverting must not remove it.
  public async down(): Promise<void> {}
}
