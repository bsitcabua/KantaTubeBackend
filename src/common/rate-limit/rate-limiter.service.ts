import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface RateLimitBucket {
  timestamps: number[];
}

@Injectable()
export class RateLimiterService {
  checkSearch(clientId: string): void {
    this.check(`search:${clientId}`, 20, 60_000, 'youtube_search_rate_limited');
  }

  checkRegistration(clientId: string): void {
    this.check(
      `personal-key:${clientId}`,
      5,
      15 * 60_000,
      'personal_key_registration_limited',
    );
  }

  checkBugReport(clientId: string): void {
    this.check(
      `bug-report:${clientId}`,
      3,
      60 * 60_000,
      'bug_report_rate_limited',
    );
  }

  checkVisitorCreation(clientId: string): void {
    this.check(
      `visitor-create:${clientId}`,
      20,
      60 * 60_000,
      'visitor_creation_rate_limited',
    );
  }

  checkSearchLog(clientId: string): void {
    this.check(
      `search-log:${clientId}`,
      60,
      60 * 60_000,
      'search_log_rate_limited',
    );
  }

  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly maximumBuckets = 5000;

  private check(
    bucketKey: string,
    limit: number,
    windowMs: number,
    code: string,
  ): void {
    const now = Date.now();
    const cutoff = now - windowMs;
    const bucket = this.buckets.get(bucketKey) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter(
      (timestamp) => timestamp > cutoff,
    );

    if (bucket.timestamps.length >= limit) {
      throw new HttpException(
        {
          code,
          message: 'Too many requests. Please wait and try again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.timestamps.push(now);
    this.buckets.set(bucketKey, bucket);
    this.trimBuckets();
  }

  private trimBuckets(): void {
    if (this.buckets.size <= this.maximumBuckets) {
      return;
    }

    const oldestKey = this.buckets.keys().next().value as string | undefined;
    if (oldestKey) {
      this.buckets.delete(oldestKey);
    }
  }
}
