import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BugReportController } from './bug-report.controller';
import { BugReportService } from './bug-report.service';
import { BugReport } from './entities/bug-report.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BugReport])],
  controllers: [BugReportController],
  providers: [BugReportService],
})
export class BugReportModule {}
