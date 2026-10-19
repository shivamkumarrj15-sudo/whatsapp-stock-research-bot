"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisIoAdapter = exports.WS_REDIS_QUIT_TIMEOUT_MS = void 0;
exports.isWsRedisEnabled = isWsRedisEnabled;
exports.wsRedisOptions = wsRedisOptions;
const platform_socket_io_1 = require("@nestjs/platform-socket.io");
const redis_adapter_1 = require("@socket.io/redis-adapter");
const ioredis_1 = __importDefault(require("ioredis"));
const logger_service_1 = require("../../common/services/logger.service");
const redis_options_1 = require("../../config/redis-options");
const logger = (0, logger_service_1.createLogger)('RedisIoAdapter');
exports.WS_REDIS_QUIT_TIMEOUT_MS = 2000;
function isWsRedisEnabled() {
    return process.env.REDIS_ENABLED === 'true';
}
function wsRedisOptions() {
    return {
        ...(0, redis_options_1.redisConnectionOptions)(),
        retryStrategy: times => Math.min(times * 500, 5000),
    };
}
class RedisIoAdapter extends platform_socket_io_1.IoAdapter {
    pubClient;
    subClient;
    constructor(app) {
        super(app);
    }
    createIOServer(port, options) {
        const server = super.createIOServer(port, options);
        if (!isWsRedisEnabled())
            return server;
        try {
            const pubClient = new ioredis_1.default(wsRedisOptions());
            const subClient = pubClient.duplicate({ maxRetriesPerRequest: null });
            for (const [name, client] of [
                ['pub', pubClient],
                ['sub', subClient],
            ]) {
                client.on('error', err => logger.warn(`Redis ${name} client error: ${err.message}`));
            }
            const publish = pubClient.publish.bind(pubClient);
            pubClient.publish = (channel, message) => publish(channel, message).catch((err) => {
                logger.debug(`Redis publish dropped: ${err.message}`);
                return 0;
            });
            this.pubClient = pubClient;
            this.subClient = subClient;
            server.adapter((0, redis_adapter_1.createAdapter)(pubClient, subClient));
            logger.log('WebSocket events fan out across replicas via the Redis adapter');
        }
        catch (error) {
            logger.error('Could not attach the Redis WebSocket adapter; falling back to single-node event delivery. ' +
                'Events raised on other replicas will not reach clients connected here.', error instanceof Error ? error.stack : String(error));
        }
        return server;
    }
    async close(server) {
        await super.close(server);
        await Promise.allSettled([this.quitClient(this.pubClient), this.quitClient(this.subClient)]);
        this.pubClient = undefined;
        this.subClient = undefined;
    }
    async quitClient(client) {
        if (!client)
            return;
        let timer;
        const deadline = new Promise(resolve => {
            timer = setTimeout(resolve, exports.WS_REDIS_QUIT_TIMEOUT_MS);
            timer.unref();
        });
        try {
            await Promise.race([client.quit().catch(() => undefined), deadline]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
            client.disconnect();
        }
    }
}
exports.RedisIoAdapter = RedisIoAdapter;
//# sourceMappingURL=redis-io.adapter.js.map