import {
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import { BugReportService } from './bug-report.service';
import { parseBugReportCreateDto } from './bug-report.dto';
import {
  BUG_REPORT_MAX_FILE_SIZE_BYTES,
  bugReportFileFilter,
  BugReportUpload,
} from './bug-report.upload';

@Controller('bug-report')
export class BugReportController {
  constructor(
    private readonly bugReportService: BugReportService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @Post('create')
  @UseInterceptors(
    FileInterceptor('screenshot', {
      storage: memoryStorage(),
      limits: {
        fileSize: BUG_REPORT_MAX_FILE_SIZE_BYTES,
        files: 1,
        fields: 5,
        fieldSize: 20_000,
      },
      fileFilter: bugReportFileFilter,
    }),
  )
  create(
    @Body() payload: unknown,
    @UploadedFile() file: BugReportUpload | undefined,
    @Req() request: Request,
  ) {
    this.rateLimiter.checkBugReport(request.ip || 'unknown');
    return this.bugReportService.create(parseBugReportCreateDto(payload), file);
  }
}
