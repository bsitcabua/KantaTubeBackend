import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BugReport } from './entities/bug-report.entity';

@Injectable()
export class BugReportService {

    constructor(
        @InjectRepository(BugReport)
        private bugReportRepo: Repository<BugReport>,
    ) {}

    async findAll(): Promise<BugReport[]> {
        return this.bugReportRepo.find();
    }
    
    async create(payload: any, file?: any): Promise<BugReport> {
        // Build the URL/path where the file is stored
        const finalScreenshotUrl = file ? `/uploads/bug-reports/${file.filename}` : null;
        
        const data = this.bugReportRepo.create({
            name: payload.name,
            email: payload.email,
            description: payload.description,
            steps: payload.steps,
            broswer_device: payload.browserDevice, 
            screenshot_url: finalScreenshotUrl, // Set the clean generated URL!
        });
        
        return this.bugReportRepo.save(data);
    }
}
