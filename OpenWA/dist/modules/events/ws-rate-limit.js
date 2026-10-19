"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlidingWindowLimiter = exports.TokenBucketLimiter = void 0;
exports.readWsRateLimitConfig = readWsRateLimitConfig;
const DEFAULT_FRAME_PER_SECOND = 60;
const DEFAULT_FRAME_BURST = 120;
const DEFAULT_HANDSHAKE_MAX = 10;
const DEFAULT_HANDSHAKE_WINDOW_MS = 60_000;
const DEFAULT_MAX_SOCKETS_PER_KEY = 16;
const DEFAULT_MAX_KEYS = 50_000;
const parsePositiveInt = (raw, fallback) => {
    if (!raw || raw.trim() === '')
        return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return fallback;
    const i = Math.floor(n);
    return i >= 1 ? i : fallback;
};
function readWsRateLimitConfig(env = process.env) {
    return {
        framePerSecond: parsePositiveInt(env['WS_RATE_LIMIT_FRAME_PER_SECOND'], DEFAULT_FRAME_PER_SECOND),
        frameBurst: parsePositiveInt(env['WS_RATE_LIMIT_FRAME_BURST'], DEFAULT_FRAME_BURST),
        handshakeMax: parsePositiveInt(env['WS_RATE_LIMIT_HANDSHAKE_MAX'], DEFAULT_HANDSHAKE_MAX),
        handshakeWindowMs: parsePositiveInt(env['WS_RATE_LIMIT_HANDSHAKE_WINDOW_MS'], DEFAULT_HANDSHAKE_WINDOW_MS),
        maxSocketsPerKey: parsePositiveInt(env['WS_MAX_SOCKETS_PER_KEY'], DEFAULT_MAX_SOCKETS_PER_KEY),
    };
}
function evictOverflow(map, maxKeys) {
    while (map.size > Math.max(1, maxKeys)) {
        const oldest = map.keys().next().value;
        if (oldest === undefined)
            break;
        map.delete(oldest);
    }
}
class TokenBucketLimiter {
    refillPerSecond;
    capacity;
    now;
    maxKeys;
    buckets = new Map();
    constructor(refillPerSecond = DEFAULT_FRAME_PER_SECOND, capacity = DEFAULT_FRAME_BURST, now = () => Date.now(), maxKeys = DEFAULT_MAX_KEYS) {
        this.refillPerSecond = refillPerSecond;
        this.capacity = capacity;
        this.now = now;
        this.maxKeys = maxKeys;
    }
    allow(subject) {
        const t = this.now();
        let bucket = this.buckets.get(subject);
        if (!bucket) {
            bucket = { tokens: this.capacity, lastRefill: t };
        }
        else if (t > bucket.lastRefill) {
            bucket.tokens = Math.min(this.capacity, bucket.tokens + ((t - bucket.lastRefill) * this.refillPerSecond) / 1000);
            bucket.lastRefill = t;
        }
        const allowed = bucket.tokens >= 1;
        if (allowed)
            bucket.tokens -= 1;
        this.buckets.delete(subject);
        this.buckets.set(subject, bucket);
        evictOverflow(this.buckets, this.maxKeys);
        return allowed;
    }
}
exports.TokenBucketLimiter = TokenBucketLimiter;
class SlidingWindowLimiter {
    max;
    windowMs;
    now;
    maxKeys;
    hits = new Map();
    constructor(max = DEFAULT_HANDSHAKE_MAX, windowMs = DEFAULT_HANDSHAKE_WINDOW_MS, now = () => Date.now(), maxKeys = DEFAULT_MAX_KEYS) {
        this.max = max;
        this.windowMs = windowMs;
        this.now = now;
        this.maxKeys = maxKeys;
    }
    allow(subject) {
        const t = this.now();
        const recent = (this.hits.get(subject) ?? []).filter(ts => t - ts < this.windowMs);
        const allowed = recent.length < this.max;
        if (allowed)
            recent.push(t);
        this.hits.delete(subject);
        this.hits.set(subject, recent);
        evictOverflow(this.hits, this.maxKeys);
        return allowed;
    }
    refund(subject) {
        const recent = this.hits.get(subject);
        if (!recent?.length)
            return;
        recent.pop();
    }
}
exports.SlidingWindowLimiter = SlidingWindowLimiter;
//# sourceMappingURL=ws-rate-limit.js.map