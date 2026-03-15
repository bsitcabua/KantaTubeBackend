import { Controller, Get, Post, Body, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
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
    @UseInterceptors(FileInterceptor('screenshot', {
        storage: diskStorage({
            destination: (req, file, cb) => {
                const uploadPath = './uploads/bug-reports';
                // Automatically create the folder if it doesn't exist
                if (!existsSync(uploadPath)) {
                    mkdirSync(uploadPath, { recursive: true });
                }
                cb(null, uploadPath);
            },
            filename: (req, file, cb) => {
                // Generate a random 16-character string for the filename
                const randomName = Array(16).fill(null).map(() => Math.round(Math.random() * 16).toString(16)).join('');
                cb(null, `${randomName}${extname(file.originalname)}`);
            }
        })
    }))
    create(
        @Body() payload: any,
        @UploadedFile() file: any
    ): Promise<BugReport> {
        // Pass both the payload and the uploaded file to the service
        return this.bugReportService.create(payload, file);
    }
}