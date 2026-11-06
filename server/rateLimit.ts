import { createRateLimiter } from "./rateLimitEngine.js";

/**
 * Rate-limit adapter: the shared engine (rateLimitEngine.js) with this project's
 * slug and one bucket per LLM route. The engine handles X-Forwarded-For, central
 * config from the control sheet, event mode, the kill switch (503) and fail-open.
 * Without Upstash credentials it is a no-op, which is what local dev wants.
 */
const limiter = createRateLimiter({
  // Slug = full project folder name (matches the central control-sheet rows).
  project: "ail-ay2627-s1-joshua-syllabuddy",
  buckets: {
    extract: Number(process.env.RATE_LIMIT_EXTRACT_MAX || 5),
    adjust: Number(process.env.RATE_LIMIT_ADJUST_MAX || 5),
  },
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN,
  defaultWindow: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 432000),
});

export const limitExtract = limiter("extract");
export const limitAdjust = limiter("adjust");
