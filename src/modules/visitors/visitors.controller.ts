import { Controller, Get, Post, Body } from '@nestjs/common';
import { VisitorsService } from './visitors.service';
import { Visitor } from './entities/visitor.entity';

@Controller('visitors')
export class VisitorsController {

  constructor(private readonly visitorsService: VisitorsService) {}
  
  @Get()
  findAll(): Promise<Visitor[]> {
    return this.visitorsService.findAll();
  }

  @Get('connecting')
  async connecting(): Promise<{ success: boolean; status: number }> {
    return {
      success: true,
      status: 200,
    };
  }

  @Post('create')
  create(@Body() visitor: Partial<Visitor>): Promise<Visitor> {
    return this.visitorsService.create(visitor);
  }
}
