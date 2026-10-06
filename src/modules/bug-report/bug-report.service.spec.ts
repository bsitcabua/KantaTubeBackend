import { BugReportService } from './bug-report.service';

describe('BugReportService', () => {
  it('accepts a report without an attachment and does not expose storage details', async () => {
    const repository = {
      create: jest.fn((value) => ({ id: 7, created_at: new Date(), ...value })),
      save: jest.fn(async (value) => value),
    };
    const service = new BugReportService(repository as any);

    const response = await service.create({
      name: 'Singer',
      email: 'singer@example.com',
      description: 'The player stopped.',
    });

    expect(response).toEqual({ id: 7, createdAt: expect.any(Date) });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ screenshot_url: null }),
    );
    expect(JSON.stringify(response)).not.toContain('uploads');
  });
});
