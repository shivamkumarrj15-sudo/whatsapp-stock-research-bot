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
exports.nodeOwnsSession = exports.SessionOwnershipService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const config_1 = require("@nestjs/config");
const node_os_1 = require("node:os");
const typeorm_2 = require("typeorm");
const session_entity_1 = require("./entities/session.entity");
const logger_service_1 = require("../../common/services/logger.service");
const date_transformer_1 = require("../../common/transformers/date.transformer");
function leaseParam(at) {
    return date_transformer_1.DateTransformer.to(at) ?? at;
}
let SessionOwnershipService = class SessionOwnershipService {
    sessions;
    configService;
    logger = (0, logger_service_1.createLogger)('SessionOwnershipService');
    heartbeat;
    owned = new Set();
    claimGen = new Map();
    claimSeq = 0;
    onLeaseLost;
    onAdopted;
    lossDetectionSuspended = 0;
    engineLiveness;
    lastSeenLease = new Map();
    foreignStreak = new Map();
    duplicateReported = false;
    constructor(sessions, configService) {
        this.sessions = sessions;
        this.configService = configService;
    }
    get nodeId() {
        return this.configService?.get('session.nodeId') || process.env.NODE_ID || (0, node_os_1.hostname)();
    }
    get nodeUrl() {
        return this.configService?.get('session.nodeUrl') || process.env.NODE_URL || '';
    }
    get leaseTtlMs() {
        return this.configService?.get('session.leaseTtlMs') ?? 60_000;
    }
    get heartbeatMs() {
        return this.configService?.get('session.leaseHeartbeatMs') ?? 20_000;
    }
    claimableWhere(now = new Date()) {
        return [{ nodeId: (0, typeorm_2.IsNull)() }, { nodeId: this.nodeId }, { leaseExpiresAt: (0, typeorm_2.LessThan)(now) }];
    }
    async claimable(ids) {
        if (ids.length === 0)
            return [];
        const rows = await this.sessions.find({
            where: this.claimableWhere().map(clause => ({ ...clause, id: (0, typeorm_2.In)(ids) })),
            select: { id: true },
        });
        return rows.map(row => row.id);
    }
    async claim(sessionId) {
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + this.leaseTtlMs);
        const previous = this.onAdopted
            ? await this.sessions.findOne({
                where: { id: sessionId },
                select: { id: true, nodeId: true, leaseExpiresAt: true },
            })
            : null;
        const result = await this.sessions
            .createQueryBuilder()
            .update(session_entity_1.Session)
            .set({
            nodeId: this.nodeId,
            claimedAt: now,
            leaseExpiresAt,
            nodeUrl: this.nodeUrl || null,
        })
            .where('id = :id', { id: sessionId })
            .andWhere('("nodeId" IS NULL OR "nodeId" = :me OR "leaseExpiresAt" < :now)', {
            me: this.nodeId,
            now: leaseParam(now),
        })
            .execute();
        const claimed = (result.affected ?? 0) > 0;
        if (claimed) {
            this.owned.add(sessionId);
            this.claimGen.set(sessionId, ++this.claimSeq);
            this.lastSeenLease.set(sessionId, leaseExpiresAt.getTime());
            const adopted = previous?.nodeId != null &&
                previous.nodeId !== this.nodeId &&
                previous.leaseExpiresAt != null &&
                previous.leaseExpiresAt < now;
            if (adopted)
                this.followAdoption(sessionId);
        }
        else
            this.logger.warn('Session is held by another node', { sessionId, nodeId: this.nodeId });
        return claimed;
    }
    async release(sessionId) {
        const now = new Date();
        this.owned.delete(sessionId);
        this.claimGen.delete(sessionId);
        const cleared = { nodeId: null, claimedAt: null, leaseExpiresAt: null, nodeUrl: null };
        const own = await this.sessions
            .createQueryBuilder()
            .update(session_entity_1.Session)
            .set(cleared)
            .where('id = :id', { id: sessionId })
            .andWhere('"nodeId" = :me', { me: this.nodeId })
            .execute();
        if ((own.affected ?? 0) > 0)
            return;
        const lapsed = await this.sessions
            .createQueryBuilder()
            .update(session_entity_1.Session)
            .set(cleared)
            .where('id = :id', { id: sessionId })
            .andWhere('"nodeId" IS NOT NULL AND "nodeId" <> :me AND "leaseExpiresAt" < :now', {
            me: this.nodeId,
            now: leaseParam(now),
        })
            .execute();
        if ((lapsed.affected ?? 0) > 0)
            this.followAdoption(sessionId);
    }
    async releaseAll(keep = []) {
        const kept = new Set(keep);
        const ids = [...this.owned].filter(id => !kept.has(id));
        for (const id of ids) {
            this.owned.delete(id);
            this.claimGen.delete(id);
        }
        if (ids.length === 0)
            return;
        await this.sessions
            .createQueryBuilder()
            .update(session_entity_1.Session)
            .set({ nodeId: null, claimedAt: null, leaseExpiresAt: null, nodeUrl: null })
            .where({ id: (0, typeorm_2.In)(ids), nodeId: this.nodeId })
            .execute();
        this.logger.log(`Released ${ids.length} session claim(s) on shutdown`, { nodeId: this.nodeId });
    }
    startHeartbeat() {
        if (this.heartbeat)
            return;
        this.heartbeat = setInterval(() => {
            void this.renew();
        }, this.heartbeatMs);
        this.heartbeat.unref?.();
    }
    stopHeartbeat() {
        if (!this.heartbeat)
            return;
        clearInterval(this.heartbeat);
        this.heartbeat = undefined;
    }
    onLeaseLoss(handler) {
        this.onLeaseLost = handler;
    }
    onAdoption(handler) {
        this.onAdopted = handler;
    }
    followAdoption(sessionId) {
        const handler = this.onAdopted;
        if (!handler)
            return;
        void Promise.resolve()
            .then(() => handler(sessionId))
            .catch((error) => this.logger.warn('Session adoption follow-up failed', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        }));
    }
    suspendLossDetection() {
        this.lossDetectionSuspended++;
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.lossDetectionSuspended--;
        };
    }
    setEngineLiveness(probe) {
        this.engineLiveness = probe;
    }
    async renew() {
        const held = [...this.owned];
        const heldGen = new Map(held.map(id => [id, this.claimGen.get(id)]));
        const live = this.engineLiveness ? held.filter(id => this.engineLiveness(id)) : held;
        let kept;
        try {
            const mine = await this.sessions
                .createQueryBuilder('s')
                .select(['s.id', 's.leaseExpiresAt'])
                .where('s.nodeId = :me', { me: this.nodeId })
                .getMany();
            this.noteForeignRenewals(mine);
            if (held.length === 0)
                return;
            if (live.length > 0) {
                const leaseExpiresAt = new Date(Date.now() + this.leaseTtlMs);
                await this.sessions
                    .createQueryBuilder()
                    .update(session_entity_1.Session)
                    .set({ leaseExpiresAt })
                    .where({ id: (0, typeorm_2.In)(live), nodeId: this.nodeId })
                    .execute();
                for (const id of live)
                    this.lastSeenLease.set(id, leaseExpiresAt.getTime());
            }
            const rows = await this.sessions.find({ where: { id: (0, typeorm_2.In)(held), nodeId: this.nodeId }, select: { id: true } });
            kept = new Set(rows.map(row => row.id));
        }
        catch (error) {
            this.logger.warn('Failed to renew session leases', {
                nodeId: this.nodeId,
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }
        if (this.lossDetectionSuspended > 0)
            return;
        const lost = held.filter(id => !kept.has(id) && this.owned.has(id) && this.claimGen.get(id) === heldGen.get(id));
        if (lost.length === 0)
            return;
        for (const id of lost) {
            this.owned.delete(id);
            this.claimGen.delete(id);
        }
        this.logger.warn(`Lost the claim on ${lost.length} session(s); another node now holds them`, {
            nodeId: this.nodeId,
            sessionIds: lost,
        });
        try {
            await this.onLeaseLost?.(lost);
        }
        catch (error) {
            this.logger.error('Failed to release engines for lost sessions', error instanceof Error ? error.stack : '', {
                nodeId: this.nodeId,
                sessionIds: lost,
            });
        }
    }
    noteForeignRenewals(rows) {
        if (this.lossDetectionSuspended > 0) {
            this.lastSeenLease.clear();
            this.foreignStreak.clear();
            return;
        }
        const now = Date.now();
        const seen = new Set();
        const flagged = [];
        for (const row of rows) {
            const at = row.leaseExpiresAt?.getTime();
            if (at === undefined || at <= now)
                continue;
            seen.add(row.id);
            const prev = this.lastSeenLease.get(row.id);
            const streak = prev !== undefined && prev !== at ? (this.foreignStreak.get(row.id) ?? 0) + 1 : 0;
            this.foreignStreak.set(row.id, streak);
            this.lastSeenLease.set(row.id, at);
            if (streak >= 2)
                flagged.push(row.id);
        }
        for (const id of [...this.lastSeenLease.keys()]) {
            if (seen.has(id))
                continue;
            this.lastSeenLease.delete(id);
            this.foreignStreak.delete(id);
        }
        if (flagged.length === 0 || this.duplicateReported)
            return;
        this.duplicateReported = true;
        this.logger.error('Another process is renewing session leases under this NODE_ID; set a unique NODE_ID per process', undefined, { action: 'duplicate_node_id', nodeId: this.nodeId, sessionIds: flagged });
    }
    async lapsedHeldByOthers(now = new Date()) {
        return this.sessions
            .createQueryBuilder('session')
            .where('"nodeId" IS NOT NULL AND "nodeId" <> :me', { me: this.nodeId })
            .andWhere('"leaseExpiresAt" < :now', { now: leaseParam(now) })
            .getMany();
    }
    async isHeldByOtherNode(sessionId, now = new Date()) {
        const count = await this.sessions
            .createQueryBuilder('session')
            .where('id = :id', { id: sessionId })
            .andWhere('"nodeId" IS NOT NULL AND "nodeId" <> :me', { me: this.nodeId })
            .andWhere('"leaseExpiresAt" > :now', { now: leaseParam(now) })
            .getCount();
        return count > 0;
    }
    heldByOtherLiveNode(session, now = new Date()) {
        return (session.nodeId != null &&
            session.nodeId !== this.nodeId &&
            session.leaseExpiresAt != null &&
            session.leaseExpiresAt > now);
    }
    async heldByOtherNodes(now = new Date()) {
        const rows = await this.sessions
            .createQueryBuilder('session')
            .select('session.id', 'id')
            .where('"nodeId" IS NOT NULL AND "nodeId" <> :me', { me: this.nodeId })
            .andWhere('"leaseExpiresAt" > :now', { now: leaseParam(now) })
            .getRawMany();
        return rows.map(row => row.id);
    }
    ownedIds() {
        return [...this.owned];
    }
    owns(sessionId) {
        return this.owned.has(sessionId);
    }
};
exports.SessionOwnershipService = SessionOwnershipService;
exports.SessionOwnershipService = SessionOwnershipService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(session_entity_1.Session, 'data')),
    __param(1, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        config_1.ConfigService])
], SessionOwnershipService);
const nodeOwnsSession = (ownership, sessionId) => !ownership || ownership.owns(sessionId);
exports.nodeOwnsSession = nodeOwnsSession;
//# sourceMappingURL=session-ownership.service.js.map