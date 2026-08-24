import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { getDatabaseOptions } from './database.config';

const options = getDatabaseOptions() as DataSourceOptions & {
  autoLoadEntities?: boolean;
};
delete options.autoLoadEntities;

export default new DataSource({
  ...options,
  entities: [__dirname + '/../modules/**/entities/*{.js,.ts}'],
} as DataSourceOptions);
