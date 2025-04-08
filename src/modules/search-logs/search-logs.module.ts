import { Module } from '@nestjs/common';
import { SearchLogsController } from './search-logs.controller';
import { SearchLogsService } from './search-logs.service';
import { SearchLogs } from './entities/search-logs.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([SearchLogs])],
  controllers: [SearchLogsController],
  providers: [SearchLogsService]
})
export class SearchLogsModule {}
