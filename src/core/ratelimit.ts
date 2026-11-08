type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const current = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= current) {
    buckets.set(key, { count: 1, resetAt: current + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
