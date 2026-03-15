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
    
    async create(payload: any): Promise<BugReport> {
        
        const data = this.bugReportRepo.create({
            name: payload.name,
            email: payload.email,
            description: payload.description,
            steps: payload.steps,
            broswer_device: payload.browserDevice, // Mapping the Angular payload property 'browserDevice' to entity 'broswer_device'
            screenshot_url: payload.screenshotUrl, // Extracting the string URL from the Angular safe URL object
        });
        return this.bugReportRepo.save(data);
    }
}
