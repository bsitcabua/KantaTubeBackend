import { Controller, Get, Post, Body } from '@nestjs/common';
import { SearchLogsService } from './search-logs.service';
import { SearchLogs } from './entities/search-logs.entity';

@Controller('search-logs')
export class SearchLogsController {

    constructor(private readonly searchLogsService: SearchLogsService) {}
      
    @Get()
    findAll(): Promise<SearchLogs[]> {
        return this.searchLogsService.findAll();
    }

    @Post('create')
    create(@Body() search: Partial<SearchLogs>): Promise<SearchLogs> {
        return this.searchLogsService.create(search);
    }
}
