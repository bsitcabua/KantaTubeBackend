import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface RateLimitBucket {
  timestamps: number[];
}

@Injectable()
export class YoutubeRateLimiterService {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly maximumBuckets = 5000;

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
          message: 'Too many YouTube requests. Please wait and try again.',
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
