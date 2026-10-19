"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.THROTTLER_REDIS_COMMAND_TIMEOUT_MS = void 0;
exports.buildThrottlerRedisOptions = buildThrottlerRedisOptions;
exports.createThrottlerRedisClient = createThrottlerRedisClient;
const ioredis_1 = __importDefault(require("ioredis"));
const redis_options_1 = require("../../config/redis-options");
exports.THROTTLER_REDIS_COMMAND_TIMEOUT_MS = 2000;
function buildThrottlerRedisOptions() {
    return {
        ...(0, redis_options_1.redisConnectionOptions)(),
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,
        commandTimeout: exports.THROTTLER_REDIS_COMMAND_TIMEOUT_MS,
        maxRetriesPerRequest: null,
    };
}
function createThrottlerRedisClient() {
    return new ioredis_1.default(buildThrottlerRedisOptions());
}
//# sourceMappingURL=throttler-redis.client.js.map