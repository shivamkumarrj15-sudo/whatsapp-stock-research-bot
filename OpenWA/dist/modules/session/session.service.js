"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = exports.AUTOSTART_SHUTDOWN_WAIT_MS = exports.AUTOSTART_THROTTLE_MS = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const promises_1 = require("node:timers/promises");
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
const session_entity_1 = require("./entities/session.entity");
const dto_1 = require("./dto");
const engine_registry_service_1 = require("../../engine/engine-registry.service");
const session_liveness_watchdog_service_1 = require("./session-liveness-watchdog.service");
const session_error_store_service_1 = require("./session-error-store.service");
const session_restriction_store_service_1 = require("./session-restriction-store.service");
const presence_store_service_1 = require("./presence-store.service");
const session_engine_lifecycle_service_1 = require("./session-engine-lifecycle.service");
const session_ownership_service_1 = require("./session-ownership.service");
const paginate_1 = require("../../common/utils/paginate");
const db_errors_1 = require("../../common/utils/db-errors");
const feature_flags_1 = require("../../config/feature-flags");
const logger_service_1 = require("../../common/services/logger.service");
const shutdown_service_1 = require("../../common/services/shutdown.service");
const hooks_1 = require("../../core/hooks");
const lid_mapping_store_service_1 = require("../../engine/identity/lid-mapping-store.service");
const jid_candidates_1 = require("../../engine/identity/jid-candidates");
const message_entity_1 = require("../message/entities/message.entity");
const session_engine_controls_1 = require("./session-engine-controls");
const SESSION_START_RETRY_DELAY_MS = 2_000;
function isTransientLaunchFailure(error) {
    if (error instanceof engine_transport_error_1.EngineTransportError)
        return true;
    if (error instanceof common_1.HttpException)
        return false;
    return error instanceof Error && (0, db_errors_1.isTransientDbError)(error);
}
exports.AUTOSTART_THROTTLE_MS = 2_000;
exports.AUTOSTART_SHUTDOWN_WAIT_MS = 5_000;
const ACTIVE_STATUSES = [
    session_entity_1.SessionStatus.READY,
    session_entity_1.SessionStatus.INITIALIZING,
    session_entity_1.SessionStatus.QR_READY,
    session_entity_1.SessionStatus.AUTHENTICATING,
    session_entity_1.SessionStatus.ACTION_REQUIRED,
];
let SessionService = class SessionService {
    sessionRepository;
    messageRepository;
    dataSource;
    engineRegistry;
    watchdog;
    sessionErrors;
    sessionRestrictions;
    presence;
    hookManager;
    engineLifecycle;
    lidMappingStore;
    configService;
    ownership;
    shutdownService;
    logger = (0, logger_service_1.createLogger)('SessionService');
    get engines() {
        return this.engineRegistry;
    }
    autoStartRun = Promise.resolve();
    shuttingDown = false;
    stopRequests = new Map();
    startReservations = new Map();
    releaseOwed = new Set();
    constructor(sessionRepository, messageRepository, dataSource, engineRegistry, watchdog, sessionErrors, sessionRestrictions, presence, hookManager, engineLifecycle, lidMappingStore, configService, ownership, shutdownService) {
        this.sessionRepository = sessionRepository;
        this.messageRepository = messageRepository;
        this.dataSource = dataSource;
        this.engineRegistry = engineRegistry;
        this.watchdog = watchdog;
        this.sessionErrors = sessionErrors;
        this.sessionRestrictions = sessionRestrictions;
        this.presence = presence;
        this.hookManager = hookManager;
        this.engineLifecycle = engineLifecycle;
        this.lidMappingStore = lidMappingStore;
        this.configService = configService;
        this.ownership = ownership;
        this.shutdownService = shutdownService;
    }
    get stopping() {
        return this.shuttingDown || this.shutdownService?.isShuttingDown() === true;
    }
    async onModuleInit() {
        const claimable = this.ownership?.claimableWhere() ?? [{}];
        const result = await this.sessionRepository.update(claimable.map(clause => ({ ...clause, status: (0, typeorm_2.In)(ACTIVE_STATUSES) })), { status: session_entity_1.SessionStatus.DISCONNECTED });
        if (result.affected && result.affected > 0) {
            this.logger.log(`Reset ${result.affected} session(s) to disconnected on startup`, {
                action: 'startup_reset',
                affected: result.affected,
                nodeId: this.ownership?.nodeId,
            });
        }
    }
    onApplicationBootstrap() {
        this.watchdog.start((id, engine, reason) => this.engineLifecycle.handleEngineDisconnected(id, engine, reason));
        this.ownership?.onLeaseLoss(async (ids) => {
            const { failed } = await this.engineLifecycle.stopOrphanEngines(ids);
            if (failed.length > 0) {
                this.logger.error('Engine teardown failed after lease loss; a peer may run a second engine on the same account until this process restarts', undefined, { sessionIds: failed, action: 'lease_loss_teardown_failed' });
            }
        });
        this.ownership?.setEngineLiveness(id => this.engineLifecycle.isEngineActive(id));
        this.ownership?.startHeartbeat();
        if (!(0, feature_flags_1.resolveFeatureFlags)(this.configService).autoStartSessions)
            return;
        this.autoStartRun = this.autoStartSessions().catch((error) => {
            this.logger.error('Auto-start scan failed', error instanceof Error ? error.message : String(error), {
                action: 'auto_start_scan_failed',
            });
        });
    }
    async autoStartSessions() {
        const claimable = this.ownership?.claimableWhere() ?? [{}];
        const sessions = await this.sessionRepository.find({
            where: claimable.map(clause => ({
                ...clause,
                phone: (0, typeorm_2.Not)((0, typeorm_2.IsNull)()),
                status: session_entity_1.SessionStatus.DISCONNECTED,
                desiredState: (0, typeorm_2.IsNull)(),
            })),
        });
        if (sessions.length === 0)
            return;
        this.logger.log(`Auto-starting ${sessions.length} previously authenticated session(s)`, {
            action: 'auto_start',
            count: sessions.length,
        });
        for (let i = 0; i < sessions.length; i++) {
            if (this.stopping) {
                this.logger.log(`Auto-start stopped at ${i} of ${sessions.length} session(s): shutting down`, {
                    action: 'auto_start_aborted',
                });
                return;
            }
            const max = (0, session_engine_lifecycle_service_1.resolveMaxConcurrentSessions)(this.configService);
            if (max !== null && !this.hasStartCapacity(max)) {
                this.logger.log(`Auto-start stopped at ${i} of ${sessions.length} session(s): MAX_CONCURRENT_SESSIONS reached`, { action: 'auto_start_capacity_reached', max });
                return;
            }
            const session = sessions[i];
            try {
                await this.start(session.id);
                if (this.shuttingDown && !this.isActive(session.id)) {
                    this.logger.log(`Auto-start abandoned for session ${session.name}: shutting down`, {
                        sessionId: session.id,
                        action: 'auto_start_aborted',
                    });
                    return;
                }
                this.logger.log(`Auto-started session: ${session.name}`, {
                    sessionId: session.id,
                    action: 'auto_start_success',
                });
            }
            catch (error) {
                if (error instanceof session_engine_controls_1.SessionStoppedException) {
                    this.logger.log(`Auto-start skipped for session ${session.name}: stopped by an operator`, {
                        sessionId: session.id,
                        action: 'auto_start_skipped',
                    });
                }
                else if (error instanceof session_engine_controls_1.ServerShuttingDownException) {
                    this.logger.log(`Auto-start abandoned for session ${session.name}: shutting down`, {
                        sessionId: session.id,
                        action: 'auto_start_aborted',
                    });
                    return;
                }
                else {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    this.logger.error(`Auto-start failed for session: ${session.name}`, errorMessage, {
                        sessionId: session.id,
                        action: 'auto_start_failed',
                    });
                }
            }
            if (i < sessions.length - 1 && !this.stopping) {
                await (0, promises_1.setTimeout)(exports.AUTOSTART_THROTTLE_MS);
            }
        }
    }
    async onModuleDestroy() {
        this.shuttingDown = true;
        this.watchdog.stop();
        this.ownership?.stopHeartbeat();
        await this.engineLifecycle.shutdown();
        let timer;
        const settled = await Promise.race([
            this.autoStartRun.then(() => true),
            new Promise(resolve => (timer = globalThis.setTimeout(resolve, exports.AUTOSTART_SHUTDOWN_WAIT_MS, false))),
        ]);
        clearTimeout(timer);
        if (!settled) {
            this.logger.warn(`Auto-start still launching after ${exports.AUTOSTART_SHUTDOWN_WAIT_MS}ms; shutting down without it`, {
                action: 'auto_start_shutdown_timeout',
            });
        }
        try {
            await this.ownership?.releaseAll(this.startReservations.keys());
        }
        catch (error) {
            this.logger.warn('Could not release the session claims at shutdown; they lapse with their lease', {
                action: 'session_claim_release_failed',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    async create(dto) {
        const existing = await this.sessionRepository.findOne({
            where: { name: dto.name },
        });
        if (existing) {
            throw new common_1.ConflictException(`Session with name '${dto.name}' already exists`);
        }
        const session = this.sessionRepository.create({
            name: dto.name,
            config: dto.config || {},
            proxyUrl: dto.proxyUrl || null,
            proxyType: dto.proxyType || null,
            status: session_entity_1.SessionStatus.CREATED,
        });
        let saved;
        try {
            saved = await this.dataSource.transaction(async (manager) => {
                return await manager.save(session);
            });
        }
        catch (err) {
            if ((0, db_errors_1.isUniqueViolation)(err)) {
                throw new common_1.ConflictException(`Session with name '${dto.name}' already exists`);
            }
            throw err;
        }
        this.logger.log(`Session created: ${saved.name}`, {
            sessionId: saved.id,
            action: 'create',
        });
        await this.hookManager.execute('session:created', dto_1.SessionResponseDto.fromEntity(saved, this.isActive(saved.id)), {
            sessionId: saved.id,
            source: 'SessionService',
        });
        return saved;
    }
    async findAll(allowedSessions, opts = {}) {
        const { limit, offset } = (0, paginate_1.resolveListWindow)(opts.limit, opts.offset);
        const options = {
            order: { createdAt: 'DESC', id: 'DESC' },
            take: limit,
            skip: offset,
        };
        const where = {};
        if (allowedSessions && allowedSessions.length > 0) {
            where.id = (0, typeorm_2.In)(allowedSessions);
        }
        if (typeof opts.name === 'string' && opts.name.length > 0) {
            where.name = opts.name;
        }
        if (Object.keys(where).length > 0) {
            options.where = where;
        }
        const sessions = await this.sessionRepository.find(options);
        return sessions.map(session => this.attachRuntimeState(session));
    }
    async findOne(id) {
        const session = await this.sessionRepository.findOne({ where: { id } });
        if (!session) {
            throw new common_1.NotFoundException(`Session with id '${id}' not found`);
        }
        return this.attachRuntimeState(session);
    }
    attachRuntimeState(session) {
        return this.sessionRestrictions.attachTo(this.sessionErrors.attachTo(session));
    }
    projectConfig(config) {
        const { maxAttempts, baseDelay } = (0, session_engine_lifecycle_service_1.resolveReconnectConfig)(config);
        return {
            autoRejectCalls: config?.autoRejectCalls === true,
            maxReconnectAttempts: Number.isFinite(maxAttempts) ? maxAttempts : null,
            reconnectBaseDelay: baseDelay,
        };
    }
    async getConfig(id) {
        const session = await this.findOne(id);
        return this.projectConfig(session.config ?? {});
    }
    async updateConfig(id, dto) {
        for (let attempt = 1;; attempt++) {
            const row = await this.sessionRepository
                .createQueryBuilder('session')
                .select('session.config', 'config')
                .where('session.id = :id', { id })
                .getRawOne();
            if (!row) {
                throw new common_1.NotFoundException(`Session with id '${id}' not found`);
            }
            const stored = row.config;
            const config = { ...(stored ? JSON.parse(stored) : null) };
            for (const key of ['autoRejectCalls', 'maxReconnectAttempts', 'reconnectBaseDelay']) {
                const value = dto[key];
                if (value === undefined)
                    continue;
                if (value === null) {
                    delete config[key];
                }
                else {
                    config[key] = value;
                }
            }
            const { affected } = await this.sessionRepository.update({ id, config: (0, typeorm_2.Raw)(column => (stored === null ? `${column} IS NULL` : `${column} = :stored`), { stored }) }, { config: config });
            if (affected !== 0) {
                return this.projectConfig(config);
            }
            if (attempt >= 5) {
                throw new common_1.ConflictException('Session config is being changed by other requests; retry');
            }
        }
    }
    async getProxy(id) {
        const session = await this.findOne(id);
        return (0, dto_1.projectSessionProxy)(session);
    }
    async updateProxy(id, dto) {
        const session = await this.findOne(id);
        if (dto.proxyUrl === null) {
            await this.sessionRepository.update(id, { proxyUrl: null, proxyType: null });
            return (0, dto_1.projectSessionProxy)({ proxyUrl: null });
        }
        if (dto.proxyUrl !== undefined) {
            await this.sessionRepository.update(id, { proxyUrl: dto.proxyUrl, proxyType: null });
            return (0, dto_1.projectSessionProxy)({ proxyUrl: dto.proxyUrl });
        }
        return (0, dto_1.projectSessionProxy)(session);
    }
    async delete(id) {
        this.markStopping(id);
        try {
            if (this.ownership)
                await this.assertNotHeldElsewhere(id);
            await this.engineLifecycle.delete(id, { onReadFailed: () => this.uncountStopRequest(id) });
            await this.ownership?.release(id);
            this.stopRequests.delete(id);
        }
        catch (error) {
            this.discardStopMarkForMissingSession(id, error);
            throw error;
        }
    }
    discardStopMarkForMissingSession(id, error) {
        if (!(error instanceof common_1.NotFoundException))
            return;
        this.engineLifecycle.clearStopping(id);
        this.stopRequests.delete(id);
    }
    async assertNotHeldElsewhere(id) {
        const heldElsewhere = await this.ownership?.isHeldByOtherNode(id).catch((error) => {
            this.engineLifecycle.clearStopping(id);
            this.uncountStopRequest(id);
            throw error;
        });
        if (heldElsewhere) {
            this.uncountStopRequest(id);
            throw new common_1.ConflictException(`Session ${id} is running on another node`);
        }
    }
    async start(id, { explicit = false } = {}) {
        this.refuseIfShuttingDown();
        const max = (0, session_engine_lifecycle_service_1.resolveMaxConcurrentSessions)(this.configService);
        if (this.ownership && max !== null) {
            const holders = this.startSlotsInUse();
            holders.delete(id);
            if (holders.size >= max) {
                await this.findOne(id);
                if (await this.ownership.isHeldByOtherNode(id)) {
                    throw new common_1.ConflictException(`Session ${id} is running on another node`);
                }
                throw new common_1.BadRequestException(`Maximum concurrent sessions reached (${max})`);
            }
        }
        this.startReservations.set(id, (this.startReservations.get(id) ?? 0) + 1);
        try {
            return await this.claimAndStart(id, explicit);
        }
        finally {
            const left = (this.startReservations.get(id) ?? 1) - 1;
            if (left > 0) {
                this.startReservations.set(id, left);
            }
            else {
                this.startReservations.delete(id);
                if (this.releaseOwed.delete(id))
                    await this.releaseUnlessEngineActive(id);
            }
        }
    }
    refuseIfShuttingDown() {
        if (this.stopping)
            throw new session_engine_controls_1.ServerShuttingDownException();
    }
    async claimAndStart(id, explicit) {
        const stopRequestsBefore = this.stopRequests.get(id);
        if (this.ownership && !(await this.ownership.claim(id))) {
            await this.findOne(id);
            throw new common_1.ConflictException(`Session ${id} is running on another node`);
        }
        let session;
        try {
            session = await this.startWithTransientRetry(id, explicit, stopRequestsBefore);
        }
        catch (error) {
            await this.keepDownIfStoppedDuringStart(id, explicit, stopRequestsBefore);
            await this.releaseUnlessEngineActive(id);
            throw error;
        }
        await this.keepDownIfStoppedDuringStart(id, explicit, stopRequestsBefore);
        await this.releaseUnlessEngineActive(id);
        return session;
    }
    async startWithTransientRetry(id, explicit, stopRequestsBefore) {
        if (this.stopRequests.get(id) !== stopRequestsBefore) {
            throw new session_engine_controls_1.SessionStoppedException(`Session ${id} was stopped`);
        }
        this.refuseIfShuttingDown();
        try {
            return await this.engineLifecycle.start(id, { explicit });
        }
        catch (error) {
            if (!isTransientLaunchFailure(error))
                throw error;
            this.logger.warn(`Transient launch failure for session ${id}; retrying once`, {
                sessionId: id,
                action: 'session_start_transient_retry',
                error: error instanceof Error ? error.message : String(error),
            });
            await (0, promises_1.setTimeout)(SESSION_START_RETRY_DELAY_MS);
            if (this.stopRequests.get(id) !== stopRequestsBefore) {
                throw new session_engine_controls_1.SessionStoppedException(`Session ${id} was stopped`);
            }
            try {
                this.refuseIfShuttingDown();
                if (this.ownership && !(await this.ownership.claim(id))) {
                    await this.findOne(id);
                    throw new common_1.ConflictException(`Session ${id} is running on another node`);
                }
                if (this.stopRequests.get(id) !== stopRequestsBefore) {
                    throw new session_engine_controls_1.SessionStoppedException(`Session ${id} was stopped`);
                }
                this.refuseIfShuttingDown();
                return await this.engineLifecycle.start(id, { explicit });
            }
            catch (retryError) {
                if (retryError instanceof session_engine_controls_1.ServerShuttingDownException) {
                    const claimable = this.ownership?.claimableWhere() ?? [{}];
                    await this.sessionRepository
                        .update(claimable.map(clause => ({ ...clause, id, status: session_entity_1.SessionStatus.FAILED })), { status: session_entity_1.SessionStatus.DISCONNECTED })
                        .catch(() => undefined);
                }
                throw retryError;
            }
        }
    }
    async stop(id) {
        this.markStopping(id);
        let session;
        try {
            if (this.ownership)
                await this.assertNotHeldElsewhere(id);
            session = await this.engineLifecycle.stop(id, {
                afterRead: () => this.keepDown(id).catch((error) => {
                    this.engineLifecycle.clearStopping(id);
                    this.uncountStopRequest(id);
                    throw error;
                }),
                onReadFailed: () => this.uncountStopRequest(id),
            });
        }
        catch (error) {
            if (error instanceof common_1.BadGatewayException)
                await this.releaseAfterTeardown(id);
            this.discardStopMarkForMissingSession(id, error);
            throw error;
        }
        await this.releaseAfterTeardown(id);
        return session;
    }
    async logout(id) {
        try {
            const session = await this.engineLifecycle.logout(id);
            await this.releaseAfterTeardown(id);
            return session;
        }
        catch (error) {
            if (!(error instanceof common_1.BadRequestException))
                await this.releaseAfterTeardown(id);
            throw error;
        }
    }
    async forceKill(id) {
        let counted = false;
        const count = () => {
            if (counted)
                return;
            counted = true;
            this.countStopRequest(id);
        };
        const uncount = () => {
            if (!counted)
                return;
            counted = false;
            this.uncountStopRequest(id);
        };
        if (this.engines.get(id))
            count();
        try {
            const session = await this.engineLifecycle.forceKill(id, { onReadFailed: uncount, onEngineFound: count });
            await this.releaseAfterTeardown(id);
            return session;
        }
        catch (error) {
            if (error instanceof common_1.BadRequestException)
                uncount();
            if (!(error instanceof common_1.BadRequestException))
                await this.releaseAfterTeardown(id);
            throw error;
        }
    }
    async keepDown(id) {
        await this.sessionRepository.update(id, { desiredState: 'stopped' });
    }
    async keepDownIfStoppedDuringStart(id, explicit, stopRequestsBefore) {
        const stoppedMeanwhile = this.stopRequests.get(id) !== stopRequestsBefore;
        if (!explicit || !stoppedMeanwhile || this.engineLifecycle.isEngineActive(id))
            return;
        await this.keepDown(id).catch((error) => this.logger.error('Failed to record a stop that landed during a start', error instanceof Error ? error.message : String(error), { sessionId: id, action: 'start_keep_down_failed' }));
    }
    markStopping(id) {
        this.countStopRequest(id);
        this.engineLifecycle.markStopping(id);
    }
    countStopRequest(id) {
        this.stopRequests.set(id, (this.stopRequests.get(id) ?? 0) + 1);
    }
    uncountStopRequest(id) {
        const remaining = (this.stopRequests.get(id) ?? 0) - 1;
        if (remaining > 0)
            this.stopRequests.set(id, remaining);
        else
            this.stopRequests.delete(id);
    }
    async releaseAfterTeardown(id) {
        if (this.startReservations.has(id))
            return;
        await this.releaseUnlessEngineActive(id);
    }
    async releaseUnlessEngineActive(id) {
        if (!this.ownership || this.engineLifecycle.isEngineActive(id)) {
            return;
        }
        if ((this.startReservations.get(id) ?? 0) > 1) {
            this.releaseOwed.add(id);
            return;
        }
        this.releaseOwed.delete(id);
        try {
            await this.ownership.release(id);
        }
        catch (error) {
            this.logger.warn(`Could not hand back the claim of session ${id}; it lapses with its lease`, {
                sessionId: id,
                action: 'session_claim_release_failed',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    async getQRCode(id) {
        const session = await this.findOne(id);
        const engine = this.engines.require(id, () => new common_1.BadRequestException('Session is not started. Call POST /sessions/:sessionId/start first.'));
        const qrCode = engine.getQRCode();
        if (!qrCode) {
            if (session.status === session_entity_1.SessionStatus.READY) {
                throw new common_1.BadRequestException('Session is already authenticated, no QR code needed');
            }
            throw new common_1.BadRequestException('QR code is not ready yet. Please wait...');
        }
        return {
            qrCode,
            status: session.status,
        };
    }
    async requestPairingCode(id, phoneNumber) {
        const session = await this.findOne(id);
        const engine = this.engines.require(id, () => new common_1.BadRequestException('Session is not started. Call POST /sessions/:sessionId/start first.'));
        if (session.status === session_entity_1.SessionStatus.READY) {
            throw new common_1.BadRequestException('Session is already authenticated, no pairing needed');
        }
        const pairingCode = await engine.requestPairingCode(phoneNumber);
        return { pairingCode, status: session.status };
    }
    getEngine(id) {
        return this.engines.get(id);
    }
    requireEngine(id) {
        return this.engines.require(id);
    }
    async listGroups(id) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        const groups = await engine.getGroups();
        return groups.map(g => ({
            id: g.id,
            name: g.name,
            linkedParentJID: g.linkedParentJID,
        }));
    }
    async listChats(id) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return [...(await engine.getChats())].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
    async getChats(id, opts = {}) {
        return (0, paginate_1.paginate)(await this.listChats(id), opts.limit, opts.offset);
    }
    async subscribeToPresence(id, chatId) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.subscribeToPresence(chatId);
    }
    async setOnlinePresence(id, available) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        await engine.setOnlinePresence(available);
        this.presence.setOwnIntent(id, available);
    }
    async getPresence(id, chatId) {
        await this.findOne(id);
        if (!this.engines.has(id))
            return null;
        return this.presence.get(id, chatId);
    }
    async sendSeen(id, chatId, messageIds) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.sendSeen(chatId, messageIds);
    }
    async markUnread(id, chatId) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.markUnread(chatId);
    }
    async clearChatMessages(id, chatId) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        const cutoff = new Date();
        const ok = await engine.clearChatMessages(chatId);
        if (ok)
            await this.purgeStoredChat(id, chatId, cutoff);
        return ok;
    }
    async archiveChat(id, chatId, archive) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.archiveChat(chatId, archive);
    }
    async muteChat(id, chatId, muteUntil) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.muteChat(chatId, muteUntil);
    }
    async pinChat(id, chatId, pin) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.pinChat(chatId, pin);
    }
    async deleteChat(id, chatId) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        const cutoff = new Date();
        const ok = await engine.deleteChat(chatId);
        if (ok)
            await this.purgeStoredChat(id, chatId, cutoff);
        return ok;
    }
    async purgeStoredChat(sessionId, chatId, cutoff) {
        const BATCH = 500;
        const bound = new Date(Math.floor(cutoff.getTime() / 1000) * 1000 - 1);
        try {
            const expanded = await (0, jid_candidates_1.resolveJidCandidates)(chatId, {
                resolveLid: lid => this.lidMappingStore.findPhoneForLid(lid),
                lidsForPhone: phone => this.lidMappingStore.findLidsForPhone(phone),
            });
            const chatIds = [...new Set([chatId, ...expanded])];
            for (;;) {
                const rows = await this.messageRepository.find({
                    where: { sessionId, chatId: (0, typeorm_2.In)(chatIds), createdAt: (0, typeorm_2.LessThanOrEqual)(bound) },
                    select: { id: true, waMessageId: true, chatId: true, sessionId: true },
                    take: BATCH,
                });
                if (rows.length === 0)
                    return;
                await this.messageRepository.delete({ id: (0, typeorm_2.In)(rows.map(row => row.id)) });
                for (const message of rows) {
                    void this.hookManager
                        .execute('message:deleted', { sessionId, message }, { sessionId, source: 'SessionService' })
                        .catch(() => undefined);
                }
                if (rows.length < BATCH)
                    return;
            }
        }
        catch (error) {
            this.logger.error('Failed to remove stored messages of a cleared chat', error instanceof Error ? error.message : String(error), { sessionId, action: 'chat_local_purge_failed' });
        }
    }
    async sendChatState(id, chatId, state) {
        await this.findOne(id);
        const engine = this.requireEngine(id);
        return engine.sendChatState(chatId, state);
    }
    async getStats(allowedSessions) {
        const scope = allowedSessions && allowedSessions.length > 0 ? allowedSessions : null;
        const qb = this.sessionRepository
            .createQueryBuilder('session')
            .select('session.status', 'status')
            .addSelect('COUNT(session.id)', 'count');
        if (scope) {
            qb.where('session.id IN (:...scope)', { scope });
        }
        const rows = await qb.groupBy('session.status').getRawMany();
        const byStatus = {};
        let total = 0;
        for (const row of rows) {
            const count = Number(row.count) || 0;
            byStatus[row.status] = count;
            total += count;
        }
        const memory = process.memoryUsage();
        return {
            total,
            active: scope ? [...this.engines.keys()].filter(id => scope.includes(id)).length : this.engines.size,
            ready: byStatus[session_entity_1.SessionStatus.READY] || 0,
            disconnected: byStatus[session_entity_1.SessionStatus.DISCONNECTED] || 0,
            byStatus,
            memoryUsage: {
                heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
                rss: Math.round(memory.rss / 1024 / 1024),
            },
        };
    }
    isActive(id) {
        return this.engines.has(id);
    }
    engineLoaded(session) {
        return this.isActive(session.id) || !!this.ownership?.heldByOtherLiveNode(session);
    }
    getActiveSessionIds() {
        return [...this.startSlotsInUse()];
    }
    hasStartCapacity(max) {
        return this.engineLifecycle.startSlotHolders().size < max;
    }
    startSlotsInUse() {
        return new Set([...this.engineLifecycle.startSlotHolders(), ...this.startReservations.keys()]);
    }
    async stopOrphanEngines(sessionIds) {
        for (const id of sessionIds)
            this.countStopRequest(id);
        return this.engineLifecycle.stopOrphanEngines(sessionIds);
    }
    async markLapsedDisconnected(sessions, goneBefore) {
        const marked = [];
        for (const session of sessions) {
            if (!ACTIVE_STATUSES.includes(session.status))
                continue;
            const unlinkedOnly = session.status === session_entity_1.SessionStatus.QR_READY;
            if (unlinkedOnly && session.phone != null)
                continue;
            if (session.nodeId == null)
                continue;
            if (session.leaseExpiresAt == null || session.leaseExpiresAt >= goneBefore)
                continue;
            let affected;
            try {
                ({ affected } = await this.sessionRepository.update({
                    id: session.id,
                    nodeId: session.nodeId,
                    leaseExpiresAt: (0, typeorm_2.LessThan)(goneBefore),
                    status: session.status,
                    ...(unlinkedOnly && { phone: (0, typeorm_2.IsNull)() }),
                }, { status: session_entity_1.SessionStatus.DISCONNECTED }));
            }
            catch (error) {
                this.logger.warn(`Failed to correct the status session ${session.name} was left in`, {
                    sessionId: session.id,
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            if (!affected)
                continue;
            this.logger.warn(`Session ${session.name} was left ${session.status} by a node that never came back`, {
                sessionId: session.id,
                action: 'lapsed_claim_reset',
                fromNode: session.nodeId,
            });
            this.engineLifecycle.announceStatus(session.id, session_entity_1.SessionStatus.DISCONNECTED);
            marked.push(session.id);
        }
        return marked;
    }
};
exports.SessionService = SessionService;
exports.SessionService = SessionService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(session_entity_1.Session, 'data')),
    __param(1, (0, typeorm_1.InjectRepository)(message_entity_1.Message, 'data')),
    __param(2, (0, typeorm_1.InjectDataSource)('data')),
    __param(11, (0, common_1.Optional)()),
    __param(12, (0, common_1.Optional)()),
    __param(13, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource,
        engine_registry_service_1.EngineRegistry,
        session_liveness_watchdog_service_1.SessionLivenessWatchdog,
        session_error_store_service_1.SessionErrorStore,
        session_restriction_store_service_1.SessionRestrictionStore,
        presence_store_service_1.PresenceStore,
        hooks_1.HookManager,
        session_engine_lifecycle_service_1.SessionEngineLifecycle,
        lid_mapping_store_service_1.LidMappingStoreService,
        config_1.ConfigService,
        session_ownership_service_1.SessionOwnershipService,
        shutdown_service_1.ShutdownService])
], SessionService);
//# sourceMappingURL=session.service.js.map