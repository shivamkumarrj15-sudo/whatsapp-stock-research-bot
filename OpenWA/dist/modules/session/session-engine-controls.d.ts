import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository, DataSource } from 'typeorm';
import { Session, SessionStatus } from './entities/session.entity';
import { EngineFactory } from '../../engine/engine.factory';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';
import { SessionErrorStore } from './session-error-store.service';
import { SessionRestrictionStore } from './session-restriction-store.service';
import { PresenceStore } from './presence-store.service';
import { type createLogger } from '../../common/services/logger.service';
import { HookManager } from '../../core/hooks';
import { SessionLifecycleFences } from './session-lifecycle-fences';
import { SessionStatusBroadcaster } from './session-status-broadcaster';
import { type ReconnectState } from './session-engine-lifecycle.service';
export declare class SessionStoppedException extends ConflictException {
}
export declare class ServerShuttingDownException extends ServiceUnavailableException {
    constructor();
}
export declare class StopMarks extends Set<string> {
    private seq;
    private readonly stamps;
    add(id: string): this;
    delete(id: string): boolean;
    stamp(id: string): number | undefined;
}
export interface StopHooks {
    afterRead?: () => Promise<void>;
    onReadFailed?: () => void;
    onEngineFound?: () => void;
}
export interface SessionEngineControlsHost {
    sessionRepository: Repository<Session>;
    engineFactory: EngineFactory;
    engines: EngineRegistry;
    sessionErrors: SessionErrorStore;
    sessionRestrictions: SessionRestrictionStore;
    presence: PresenceStore;
    hookManager: HookManager;
    configService?: ConfigService;
    logger: ReturnType<typeof createLogger>;
    dataSource(): DataSource;
    fences: SessionLifecycleFences;
    broadcaster: SessionStatusBroadcaster;
    cancelReconnect(id: string): void;
    initializeEngine(id: string, session: Session): Promise<void>;
    isSessionRetired(id: string): Promise<boolean>;
    purgeAuthDirsIfDeleted(id: string): Promise<void>;
    updateStatus(id: string, status: SessionStatus): Promise<void>;
    ownsSession(id: string): boolean;
    isClosed(): boolean;
    stoppingSessions: StopMarks;
    operatorTeardowns: Map<string, IWhatsAppEngine>;
    reconnectStates: Map<string, ReconnectState>;
    stuckAuthRecoveryUsed: Set<string>;
    initializingSessions: Set<string>;
}
export declare class SessionEngineControls {
    private readonly host;
    private readonly sessionRepository;
    private readonly engineFactory;
    private readonly engines;
    private readonly sessionErrors;
    private readonly sessionRestrictions;
    private readonly presence;
    private readonly hookManager;
    private readonly configService?;
    private readonly logger;
    private readonly fences;
    private readonly broadcaster;
    private readonly stoppingSessions;
    private readonly operatorTeardowns;
    private readonly reconnectStates;
    private readonly stuckAuthRecoveryUsed;
    private readonly initializingSessions;
    constructor(host: SessionEngineControlsHost);
    private requireSession;
    private requireSessionOrDropStopMark;
    start(id: string, { explicit }?: {
        explicit?: boolean;
    }): Promise<Session>;
    stop(id: string, hooks?: StopHooks): Promise<Session>;
    logout(id: string): Promise<Session>;
    forceKill(id: string, hooks?: StopHooks): Promise<Session>;
    delete(id: string, hooks?: StopHooks): Promise<void>;
    shutdown(): Promise<void>;
    stopOrphanEngines(sessionIds: string[]): Promise<{
        stopped: string[];
        notRunning: string[];
        failed: string[];
    }>;
}
