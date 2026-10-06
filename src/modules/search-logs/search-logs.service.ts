import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchLogs } from './entities/search-logs.entity';
import { SearchLogCreateDto } from './search-logs.dto';

@Injectable()
export class SearchLogsService {

    constructor(
        @InjectRepository(SearchLogs)
        private searchLogsRepo: Repository<SearchLogs>,
    ) {}

    async findAll(): Promise<SearchLogs[]> {
        return this.searchLogsRepo.find();
    }
    
    async create(search: SearchLogCreateDto): Promise<SearchLogs> {
        const data = this.searchLogsRepo.create(search);
        return this.searchLogsRepo.save(data);
    }
}
