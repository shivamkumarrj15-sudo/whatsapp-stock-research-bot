"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionEngineControls = exports.StopMarks = exports.ServerShuttingDownException = exports.SessionStoppedException = void 0;
const common_1 = require("@nestjs/common");
const session_entity_1 = require("./entities/session.entity");
const message_entity_1 = require("../message/entities/message.entity");
const message_batch_entity_1 = require("../message/entities/message-batch.entity");
const send_idempotency_key_entity_1 = require("../message/entities/send-idempotency-key.entity");
const webhook_entity_1 = require("../webhook/entities/webhook.entity");
const webhook_outbox_event_entity_1 = require("../webhook/entities/webhook-outbox-event.entity");
const webhook_delivery_failure_entity_1 = require("../webhook/entities/webhook-delivery-failure.entity");
const integration_delivery_failure_entity_1 = require("../integration/entities/integration-delivery-failure.entity");
const template_entity_1 = require("../template/entities/template.entity");
const engine_1 = require("../../engine");
const baileys_chat_state_entity_1 = require("../../engine/adapters/baileys-chat-state.entity");
const status_update_entity_1 = require("../status-store/entities/status-update.entity");
const session_write_scope_1 = require("../../common/utils/session-write-scope");
const session_engine_lifecycle_service_1 = require("./session-engine-lifecycle.service");
class SessionStoppedException extends common_1.ConflictException {
}
exports.SessionStoppedException = SessionStoppedException;
class ServerShuttingDownException extends common_1.ServiceUnavailableException {
    constructor() {
        super('Server is shutting down');
    }
}
exports.ServerShuttingDownException = ServerShuttingDownException;
class StopMarks extends Set {
    seq = 0;
    stamps = new Map();
    add(id) {
        this.stamps.set(id, ++this.seq);
        return super.add(id);
    }
    delete(id) {
        this.stamps.delete(id);
        return super.delete(id);
    }
    stamp(id) {
        return this.stamps.get(id);
    }
}
exports.StopMarks = StopMarks;
class SessionEngineControls {
    host;
    sessionRepository;
    engineFactory;
    engines;
    sessionErrors;
    sessionRestrictions;
    presence;
    hookManager;
    configService;
    logger;
    fences;
    broadcaster;
    stoppingSessions;
    operatorTeardowns;
    reconnectStates;
    stuckAuthRecoveryUsed;
    initializingSessions;
    constructor(host) {
        this.host = host;
        this.sessionRepository = host.sessionRepository;
        this.engineFactory = host.engineFactory;
        this.engines = host.engines;
        this.sessionErrors = host.sessionErrors;
        this.sessionRestrictions = host.sessionRestrictions;
        this.presence = host.presence;
        this.hookManager = host.hookManager;
        this.configService = host.configService;
        this.logger = host.logger;
        this.fences = host.fences;
        this.broadcaster = host.broadcaster;
        this.stoppingSessions = host.stoppingSessions;
        this.operatorTeardowns = host.operatorTeardowns;
        this.reconnectStates = host.reconnectStates;
        this.stuckAuthRecoveryUsed = host.stuckAuthRecoveryUsed;
        this.initializingSessions = host.initializingSessions;
    }
    async requireSession(id) {
        const session = await this.sessionRepository.findOne({ where: { id } });
        if (!session) {
            throw new common_1.NotFoundException(`Session with id '${id}' not found`);
        }
        return this.sessionRestrictions.attachTo(this.sessionErrors.attachTo(session));
    }
    async requireSessionOrDropStopMark(id, onReadFailed) {
        try {
            return await this.requireSession(id);
        }
        catch (error) {
            this.stoppingSessions.delete(id);
            onReadFailed?.();
            throw error;
        }
    }
    async start(id, { explicit = false } = {}) {
        if (this.initializingSessions.has(id)) {
            throw new common_1.BadRequestException('Session is already starting');
        }
        this.initializingSessions.add(id);
        const markAtEntry = this.stoppingSessions.stamp(id);
        try {
            const session = await this.requireSession(id);
            if (session.desiredState === 'stopped' && !explicit) {
                throw new SessionStoppedException(`Session ${id} was stopped`);
            }
            if (this.engines.has(id)) {
                throw new common_1.BadRequestException('Session is already started');
            }
            const maxConcurrentSessions = (0, session_engine_lifecycle_service_1.resolveMaxConcurrentSessions)(this.configService);
            if (maxConcurrentSessions !== null) {
                const activeIds = (0, session_engine_lifecycle_service_1.startSlotHolders)(this.engines, this.reconnectStates);
                activeIds.delete(id);
                if (activeIds.size >= maxConcurrentSessions) {
                    throw new common_1.BadRequestException(`Maximum concurrent sessions reached (${maxConcurrentSessions})`);
                }
            }
            await this.fences.awaitPendingTeardown(session.name);
            if (this.stoppingSessions.has(id) && this.stoppingSessions.stamp(id) !== markAtEntry) {
                throw new SessionStoppedException(`Session ${id} was stopped`);
            }
            this.stoppingSessions.delete(id);
            this.host.cancelReconnect(id);
            const { desiredState } = await this.requireSession(id);
            if (desiredState === 'stopped' && (!explicit || session.desiredState !== 'stopped')) {
                this.stoppingSessions.add(id);
                throw new SessionStoppedException(`Session ${id} was stopped`);
            }
            const closedRefusal = () => this.stoppingSessions.has(id)
                ? new SessionStoppedException(`Session ${id} was stopped`)
                : new ServerShuttingDownException();
            if (this.host.isClosed()) {
                throw closedRefusal();
            }
            if (desiredState === 'stopped') {
                await this.sessionRepository.update({ id, desiredState: 'stopped' }, { desiredState: null });
                if (this.host.isClosed()) {
                    throw closedRefusal();
                }
            }
            await this.hookManager.execute('session:starting', { sessionId: id }, {
                sessionId: id,
                source: 'SessionService',
            });
            const { maxAttempts, baseDelay } = (0, session_engine_lifecycle_service_1.resolveReconnectConfig)(session.config);
            this.reconnectStates.set(id, { attempts: 0, timer: null, maxAttempts, baseDelay });
            this.stuckAuthRecoveryUsed.delete(id);
            const before = this.engines.get(id);
            const init = this.host.initializeEngine(id, session);
            const registered = this.engines.get(id);
            const mine = registered !== before ? registered : undefined;
            let failedWritten = false;
            try {
                await init;
            }
            catch (err) {
                if (mine && this.engines.deleteIfLive(id, mine)) {
                    this.sessionErrors.set(id, err instanceof Error ? err.message : String(err));
                    await this.fences.teardownEngineSafely(id, mine, e => e.forceDestroy(), 'force-destroy');
                    if (this.host.ownsSession(id) && !this.host.isClosed()) {
                        failedWritten = true;
                        await this.host.updateStatus(id, session_entity_1.SessionStatus.FAILED).catch(() => undefined);
                    }
                }
                if (!this.engines.has(id)) {
                    this.host.cancelReconnect(id);
                }
                throw this.host.isClosed() && !failedWritten && !this.stoppingSessions.has(id)
                    ? new ServerShuttingDownException()
                    : err;
            }
            if (await this.host.isSessionRetired(id)) {
                const resurrected = this.engines.get(id);
                if (resurrected) {
                    await this.fences.destroyWithEscalation(id, resurrected);
                    this.engines.deleteIfLive(id, resurrected);
                }
                await this.host.purgeAuthDirsIfDeleted(id);
            }
            else if (this.host.isClosed()) {
                throw new ServerShuttingDownException();
            }
            return this.requireSession(id);
        }
        finally {
            this.initializingSessions.delete(id);
        }
    }
    async stop(id, hooks = {}) {
        const session = await this.requireSessionOrDropStopMark(id, hooks.onReadFailed);
        await hooks.afterRead?.();
        this.stoppingSessions.add(id);
        this.host.cancelReconnect(id);
        const engine = this.engines.get(id);
        if (engine) {
            this.operatorTeardowns.set(id, engine);
            try {
                await this.fences.awaitInitialStatus(id, engine);
                let tornDown = await this.fences.teardownEngineSafely(id, engine, e => e.disconnect(), 'disconnect');
                if (!tornDown) {
                    this.logger.warn(`Graceful disconnect failed for session ${session.name}; escalating to force-destroy`, {
                        sessionId: id,
                        action: 'stop_escalate_force_destroy',
                    });
                    tornDown = await this.fences.teardownEngineSafely(id, engine, e => e.forceDestroy(), 'force-destroy');
                }
                this.engines.deleteIfLive(id, engine);
                if (!tornDown) {
                    await this.host.updateStatus(id, session_entity_1.SessionStatus.DISCONNECTED);
                    throw new common_1.BadGatewayException({
                        statusCode: common_1.HttpStatus.BAD_GATEWAY,
                        message: 'Session was stopped locally, but the engine teardown did not complete: the engine ' +
                            'process may still be running. Retry the stop; restart the node to reap a leaked process.',
                        error: 'Bad Gateway',
                        code: 'SESSION_STOP_INCOMPLETE',
                    });
                }
            }
            finally {
                if (this.operatorTeardowns.get(id) === engine) {
                    this.operatorTeardowns.delete(id);
                }
            }
        }
        this.logger.log(`Session stopped: ${session.name}`, {
            sessionId: id,
            action: 'stop',
        });
        await this.host.updateStatus(id, session_entity_1.SessionStatus.DISCONNECTED);
        return this.requireSession(id);
    }
    async logout(id) {
        const session = await this.requireSession(id);
        const engine = this.engines.get(id);
        if (!engine) {
            throw new common_1.BadRequestException('Session is not started. Call POST /sessions/:sessionId/start first.');
        }
        this.stoppingSessions.add(id);
        this.host.cancelReconnect(id);
        this.operatorTeardowns.set(id, engine);
        let unlinked;
        try {
            await this.fences.awaitInitialStatus(id, engine);
            unlinked = await this.fences.teardownEngineSafely(id, engine, e => e.logout(), 'logout', session.name);
            this.engines.deleteIfLive(id, engine);
            await this.host.updateStatus(id, session_entity_1.SessionStatus.DISCONNECTED);
        }
        finally {
            if (this.operatorTeardowns.get(id) === engine) {
                this.operatorTeardowns.delete(id);
            }
        }
        if (!unlinked) {
            this.logger.warn(`Session stopped locally but the logout operation did not complete: ${session.name}`, {
                sessionId: id,
                action: 'logout_incomplete',
            });
            await this.sessionRepository.update(id, { phone: null });
            throw new common_1.BadGatewayException({
                statusCode: common_1.HttpStatus.BAD_GATEWAY,
                message: 'Session was stopped locally, but the logout operation is incomplete — the device may ' +
                    'still be linked. Start the session and retry the logout.',
                error: 'Bad Gateway',
                code: 'SESSION_LOGOUT_INCOMPLETE',
            });
        }
        await this.sessionRepository.update(id, { phone: null });
        this.logger.log(`Session logged out: ${session.name}`, {
            sessionId: id,
            action: 'logout',
        });
        return this.requireSession(id);
    }
    async forceKill(id, hooks = {}) {
        const session = await this.requireSession(id).catch((error) => {
            hooks.onReadFailed?.();
            throw error;
        });
        const engine = this.engines.get(id);
        if (!engine) {
            throw new common_1.BadRequestException('Session is not started. Call POST /sessions/:sessionId/start first.');
        }
        hooks.onEngineFound?.();
        this.stoppingSessions.add(id);
        this.host.cancelReconnect(id);
        await this.sessionRepository
            .update(id, { desiredState: 'stopped' })
            .catch((error) => this.logger.error('Failed to record the force-kill as a stop', error instanceof Error ? error.message : String(error), { sessionId: id, action: 'force_kill_keep_down_failed' }));
        this.operatorTeardowns.set(id, engine);
        try {
            await this.fences.awaitInitialStatus(id, engine);
            const tornDown = await this.fences.teardownEngineSafely(id, engine, e => e.forceDestroy(), 'force-destroy');
            this.engines.deleteIfLive(id, engine);
            if (!tornDown) {
                await this.host.updateStatus(id, session_entity_1.SessionStatus.DISCONNECTED);
                throw new common_1.BadGatewayException({
                    statusCode: common_1.HttpStatus.BAD_GATEWAY,
                    message: 'Session was stopped locally, but the engine force-kill did not complete: the engine ' +
                        'process may still be running. Restart the node to reap a leaked process.',
                    error: 'Bad Gateway',
                    code: 'SESSION_FORCE_KILL_INCOMPLETE',
                });
            }
            this.logger.warn(`Session force-killed: ${session.name}`, {
                sessionId: id,
                action: 'force_kill',
            });
            await this.host.updateStatus(id, session_entity_1.SessionStatus.DISCONNECTED);
        }
        finally {
            if (this.operatorTeardowns.get(id) === engine) {
                this.operatorTeardowns.delete(id);
            }
        }
        return this.requireSession(id);
    }
    async delete(id, hooks = {}) {
        const session = await this.requireSessionOrDropStopMark(id, hooks.onReadFailed);
        await this.fences.awaitPendingTeardown(session.name);
        this.stoppingSessions.add(id);
        this.host.cancelReconnect(id);
        let parentDeleted = false;
        const writes = (0, session_write_scope_1.closeSessionWrites)(this.host.dataSource(), id);
        try {
            const engine = this.engines.get(id);
            if (engine) {
                await this.fences.awaitInitialStatus(id, engine);
                await this.fences.teardownEngineSafely(id, engine, e => e.forceDestroy(), 'force-destroy');
                this.engines.deleteIfLive(id, engine);
            }
            try {
                await this.fences.awaitPendingTeardown(session.name);
            }
            catch (fenceError) {
                if (engine) {
                    await this.host.updateStatus(id, session_entity_1.SessionStatus.DISCONNECTED).catch(() => undefined);
                }
                throw fenceError;
            }
            await writes.drain();
            await this.hookManager.execute('session:deleted', {
                id: session.id,
                name: session.name,
                phone: session.phone,
                pushName: session.pushName,
            }, {
                sessionId: id,
                source: 'SessionService',
            });
            await this.host.dataSource().transaction(async (manager) => {
                await manager.delete(message_entity_1.Message, { sessionId: id });
                await manager.delete(message_batch_entity_1.MessageBatch, { sessionId: id });
                await manager.delete(baileys_chat_state_entity_1.ChatState, { sessionId: id });
                await manager.delete(status_update_entity_1.StatusUpdate, { sessionId: id });
                await manager.delete(webhook_entity_1.Webhook, { sessionId: id });
                await manager.delete(template_entity_1.Template, { sessionId: id });
                await manager.delete(engine_1.BaileysStoredMessage, { sessionId: id });
                await manager.delete(webhook_outbox_event_entity_1.WebhookOutboxEvent, { sessionId: id });
                await manager.delete(webhook_delivery_failure_entity_1.WebhookDeliveryFailure, { sessionId: id });
                await manager.delete(integration_delivery_failure_entity_1.IntegrationDeliveryFailure, { sessionId: id });
                await manager.delete(send_idempotency_key_entity_1.SendIdempotencyKey, { sessionId: id });
                await manager.remove(session);
            });
            parentDeleted = true;
            this.logger.log(`Session deleted: ${session.name}`, {
                sessionId: id,
                action: 'delete',
            });
            const nameIsAnId = await this.sessionRepository.exists({ where: { id: session.name } }).catch(() => true);
            await this.engineFactory.purgeSessionData(id, nameIsAnId ? undefined : session.name);
        }
        finally {
            writes.release();
            this.stoppingSessions.delete(id);
            if (parentDeleted) {
                this.broadcaster.clear(id);
                this.sessionErrors.clear(id);
                this.sessionRestrictions.clear(id);
                this.presence.clear(id);
                this.stuckAuthRecoveryUsed.delete(id);
            }
        }
    }
    async shutdown() {
        for (const [, state] of this.reconnectStates) {
            if (state.timer) {
                clearTimeout(state.timer);
            }
        }
        this.reconnectStates.clear();
        await Promise.allSettled([...this.engines].map(([sessionId, engine]) => this.fences.destroyEngineSafely(sessionId, engine)));
        this.engines.clear();
    }
    async stopOrphanEngines(sessionIds) {
        const stopped = [];
        const notRunning = [];
        const failed = [];
        if (sessionIds.length === 0)
            return { stopped, notRunning, failed };
        await Promise.allSettled(sessionIds.map(async (id) => {
            this.stoppingSessions.add(id);
            this.host.cancelReconnect(id);
            const engine = this.engines.get(id);
            if (!engine) {
                notRunning.push(id);
                return;
            }
            try {
                const tornDown = await this.fences.destroyWithEscalation(id, engine);
                this.engines.deleteIfLive(id, engine);
                if (tornDown) {
                    stopped.push(id);
                }
                else {
                    failed.push(id);
                }
            }
            catch (err) {
                this.logger.error(`Failed to stop orphan engine for session ${id}`, String(err), {
                    sessionId: id,
                    action: 'stop_orphan_failed',
                });
                this.engines.deleteIfLive(id, engine);
                failed.push(id);
            }
        }));
        return { stopped, notRunning, failed };
    }
}
exports.SessionEngineControls = SessionEngineControls;
//# sourceMappingURL=session-engine-controls.js.map