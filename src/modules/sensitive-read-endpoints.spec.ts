import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { BugReportController } from './bug-report/bug-report.controller';
import { BugReportService } from './bug-report/bug-report.service';
import { VisitorsController } from './visitors/visitors.controller';
import { VisitorsService } from './visitors/visitors.service';
import { SearchLogsController } from './search-logs/search-logs.controller';
import { SearchLogsService } from './search-logs/search-logs.service';
import { RateLimiterService } from '../common/rate-limit/rate-limiter.service';

describe('sensitive collection endpoints', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        VisitorsController,
        SearchLogsController,
        BugReportController,
      ],
      providers: [
        { provide: VisitorsService, useValue: {} },
        { provide: SearchLogsService, useValue: {} },
        { provide: BugReportService, useValue: {} },
        { provide: RateLimiterService, useValue: {} },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not expose visitor, search-log, or bug-report collections anonymously', async () => {
    await request(app.getHttpServer()).get('/visitors').expect(404);
    await request(app.getHttpServer()).get('/search-logs').expect(404);
    await request(app.getHttpServer()).get('/bug-report').expect(404);
  });
});
