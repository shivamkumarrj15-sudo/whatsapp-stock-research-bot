import { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { type RequestLike } from '../../common/utils/ip';
import { StatsService } from '../stats/stats.service';
export declare const METRICS_RENDER_TTL_MS = 5000;
export declare const QUEUE_READ_TIMEOUT_MS = 2000;
export declare class MetricsService implements OnModuleDestroy {
    private readonly config;
    private readonly statsService;
    private readonly webhookQueue?;
    private readonly ingressQueue?;
    private readonly logger;
    private cachedRender;
    private readonly failedScrapeLimiter;
    private readonly loopDelay;
    private lastTick;
    private readonly loopSampler;
    constructor(config: ConfigService, statsService: StatsService, webhookQueue?: Queue | undefined, ingressQueue?: Queue | undefined);
    onModuleDestroy(): void;
    private get token();
    assertScrapeAuthorized(authorizationHeader: string | undefined, client?: RequestLike): void;
    private safeEqual;
    render(): Promise<string>;
    private readQueueCounts;
    private escapeLabel;
}
