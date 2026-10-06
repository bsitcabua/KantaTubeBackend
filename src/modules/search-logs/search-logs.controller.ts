import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { SearchLogsService } from './search-logs.service';
import { parseSearchLogCreateDto } from './search-logs.dto';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';

@Controller('search-logs')
export class SearchLogsController {

    constructor(
        private readonly searchLogsService: SearchLogsService,
        private readonly rateLimiter: RateLimiterService,
    ) {}

    @Post('create')
    create(@Body() search: unknown, @Req() request: Request) {
        this.rateLimiter.checkSearchLog(request.ip || 'unknown');
        return this.searchLogsService.create(parseSearchLogCreateDto(search));
    }
}
