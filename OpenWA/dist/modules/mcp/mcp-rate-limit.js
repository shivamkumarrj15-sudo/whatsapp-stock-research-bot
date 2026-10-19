"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyRateLimiter = void 0;
exports.readRateLimitConfig = readRateLimitConfig;
exports.readIpRateLimitConfig = readIpRateLimitConfig;
const common_1 = require("@nestjs/common");
const DEFAULT_MAX = 60;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_IP_MAX = 120;
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
function readRateLimitConfig(env = process.env) {
    return {
        max: parsePositiveInt(env['MCP_RATE_LIMIT_MAX'], DEFAULT_MAX),
        windowMs: parsePositiveInt(env['MCP_RATE_LIMIT_WINDOW_MS'], DEFAULT_WINDOW_MS),
    };
}
function readIpRateLimitConfig(env = process.env) {
    return {
        max: parsePositiveInt(env['MCP_IP_RATE_LIMIT_MAX'], DEFAULT_IP_MAX),
        windowMs: parsePositiveInt(env['MCP_IP_RATE_LIMIT_WINDOW_MS'], DEFAULT_WINDOW_MS),
    };
}
class KeyRateLimiter {
    max;
    windowMs;
    now;
    maxKeys;
    hits = new Map();
    constructor(max = 60, windowMs = 60_000, now = () => Date.now(), maxKeys = DEFAULT_MAX_KEYS) {
        this.max = max;
        this.windowMs = windowMs;
        this.now = now;
        this.maxKeys = maxKeys;
    }
    check(key) {
        const t = this.now();
        const recent = (this.hits.get(key) ?? []).filter(ts => t - ts < this.windowMs);
        const throttled = recent.length >= this.max;
        if (!throttled)
            recent.push(t);
        this.hits.delete(key);
        this.hits.set(key, recent);
        while (this.hits.size > Math.max(1, this.maxKeys)) {
            const oldest = this.hits.keys().next().value;
            if (oldest === undefined)
                break;
            this.hits.delete(oldest);
        }
        if (throttled) {
            throw new common_1.HttpException('MCP rate limit exceeded', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
    }
}
exports.KeyRateLimiter = KeyRateLimiter;
//# sourceMappingURL=mcp-rate-limit.js.map