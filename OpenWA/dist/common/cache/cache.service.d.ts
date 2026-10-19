import { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export interface SessionInfo {
    id: string;
    name: string;
    status: string;
    phone?: string;
    pushName?: string;
    connectedAt?: string;
}
export interface SessionStats {
    active: number;
    total: number;
    byStatus: Record<string, number>;
}
export declare const CACHE_QUIT_TIMEOUT_MS = 2000;
export declare class CacheService implements OnModuleDestroy {
    private readonly configService;
    private readonly logger;
    private redis;
    private readonly enabled;
    constructor(configService: ConfigService);
    private ensureClient;
    private ping;
    onModuleDestroy(): Promise<void>;
    isAvailable(): Promise<boolean>;
    getSessionStatus(id: string): Promise<string | null>;
    setSessionStatus(id: string, status: string): Promise<void>;
    getSessionInfo(id: string): Promise<SessionInfo | null>;
    setSessionInfo(id: string, info: SessionInfo): Promise<void>;
    getSessionQR(id: string): Promise<string | null>;
    setSessionQR(id: string, qr: string): Promise<void>;
    getSessionsList(): Promise<string[] | null>;
    setSessionsList(ids: string[]): Promise<void>;
    getSessionsStats(): Promise<SessionStats | null>;
    setSessionsStats(stats: SessionStats): Promise<void>;
}
