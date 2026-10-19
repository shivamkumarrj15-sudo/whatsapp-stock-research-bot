import Redis, { RedisOptions } from 'ioredis';
export declare const THROTTLER_REDIS_COMMAND_TIMEOUT_MS = 2000;
export declare function buildThrottlerRedisOptions(): RedisOptions;
export declare function createThrottlerRedisClient(): Redis;
