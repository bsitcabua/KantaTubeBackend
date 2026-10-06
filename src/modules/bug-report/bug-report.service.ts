import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { Repository } from 'typeorm';
import { BugReport } from './entities/bug-report.entity';
import { BugReportCreateDto } from './bug-report.dto';
import {
  BugReportUpload,
  createSafeBugReportFilename,
  validateBugReportUpload,
} from './bug-report.upload';

export interface BugReportSubmissionResponse {
  id: number;
  createdAt: Date;
}

@Injectable()
export class BugReportService {
  constructor(
    @InjectRepository(BugReport)
    private bugReportRepo: Repository<BugReport>,
  ) {}

  async create(
    payload: BugReportCreateDto,
    file?: BugReportUpload,
  ): Promise<BugReportSubmissionResponse> {
    const format = file ? validateBugReportUpload(file) : undefined;
    let storedPath: string | undefined;
    let storedRelativePath: string | null = null;

    if (file && format) {
      const uploadDirectory = join(process.cwd(), 'uploads', 'bug-reports');
      await mkdir(uploadDirectory, { recursive: true });
      const filename = createSafeBugReportFilename(format);
      storedPath = join(uploadDirectory, filename);
      storedRelativePath = join('bug-reports', filename);
      await writeFile(storedPath, file.buffer, { flag: 'wx', mode: 0o600 });
    }

    try {
      const data = this.bugReportRepo.create({
        name: payload.name,
        email: payload.email,
        description: payload.description,
        steps: payload.steps,
        broswer_device: payload.browserDevice,
        screenshot_url: storedRelativePath,
      });
      const saved = await this.bugReportRepo.save(data);
      return { id: saved.id, createdAt: saved.created_at };
    } catch (error) {
      if (storedPath) {
        await unlink(storedPath).catch(() => undefined);
      }
      throw error;
    }
  }
}
