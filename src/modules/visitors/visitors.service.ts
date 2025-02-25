import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visitor } from './entities/visitor.entity';

@Injectable()
export class VisitorsService {
  constructor(
    @InjectRepository(Visitor)
    private visitorsRepository: Repository<Visitor>,
  ) {}

  async findAll(): Promise<Visitor[]> {
    return this.visitorsRepository.find();
  }

  async create(user: Partial<Visitor>): Promise<Visitor> {
    return this.visitorsRepository.save(user);
  }
}
