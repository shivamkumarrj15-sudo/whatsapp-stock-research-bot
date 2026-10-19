import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { type RedisOptions } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
export declare const WS_REDIS_QUIT_TIMEOUT_MS = 2000;
export declare function isWsRedisEnabled(): boolean;
export declare function wsRedisOptions(): RedisOptions;
export declare class RedisIoAdapter extends IoAdapter {
    private pubClient?;
    private subClient?;
    constructor(app: INestApplicationContext);
    createIOServer(port: number, options?: ServerOptions): Server;
    close(server: Server): Promise<void>;
    private quitClient;
}
