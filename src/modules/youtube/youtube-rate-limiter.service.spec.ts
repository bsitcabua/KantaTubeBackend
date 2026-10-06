import { YoutubeRateLimiterService } from './youtube-rate-limiter.service';

describe('YoutubeRateLimiterService', () => {
  it('limits repeated personal-key registrations', () => {
    const service = new YoutubeRateLimiterService();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      service.checkRegistration('client');
    }

    expect(() => service.checkRegistration('client')).toThrow();
    expect(() => service.checkRegistration('other-client')).not.toThrow();
  });

  it('limits repeated searches independently from registrations', () => {
    const service = new YoutubeRateLimiterService();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      service.checkSearch('client');
    }

    expect(() => service.checkSearch('client')).toThrow();
  });

  it('limits public bug-report submissions per client', () => {
    const service = new YoutubeRateLimiterService();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      service.checkBugReport('client');
    }

    expect(() => service.checkBugReport('client')).toThrow();
  });
});
