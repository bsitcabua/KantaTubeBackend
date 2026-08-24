import { DataSourceOptions } from 'typeorm';

export function getDatabaseOptions(): DataSourceOptions {
  return {
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kantatube',
    ssl:
      process.env.DB_SSL === 'false'
        ? undefined
        : { minVersion: 'TLSv1.2', rejectUnauthorized: false },
    autoLoadEntities: true,
    synchronize: false,
    migrations: [__dirname + '/migrations/*{.js,.ts}'],
  } as DataSourceOptions;
}
