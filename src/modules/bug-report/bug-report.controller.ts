import { Controller, Get, Post, Body } from '@nestjs/common';
import { BugReportService } from './bug-report.service';
import { BugReport } from './entities/bug-report.entity';

@Controller('bug-report')
export class BugReportController {

    constructor(private readonly bugReportService: BugReportService) {}
      
    @Get()
    findAll(): Promise<BugReport[]> {
        return this.bugReportService.findAll();
    }

    @Post('create')
    create(@Body() bugReport: Partial<BugReport>): Promise<BugReport> {
        return this.bugReportService.create(bugReport);
    }
}
