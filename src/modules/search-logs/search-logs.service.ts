import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchLogs } from './entities/search-logs.entity';

@Injectable()
export class SearchLogsService {

    constructor(
        @InjectRepository(SearchLogs)
        private searchLogsRepo: Repository<SearchLogs>,
    ) {}

    async findAll(): Promise<SearchLogs[]> {
        return this.searchLogsRepo.find();
    }
    
    async create(search: Partial<SearchLogs>): Promise<SearchLogs> {
        const data = this.searchLogsRepo.create(search);
        return this.searchLogsRepo.save(data);
    }
}
