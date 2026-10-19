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
exports.ChatMediaArchiveService = exports.DEFAULT_ARCHIVE_MAX_BYTES = exports.CHAT_MEDIA_PREFIX = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const config_1 = require("@nestjs/config");
const typeorm_2 = require("typeorm");
const crypto_1 = require("crypto");
const message_entity_1 = require("../message/entities/message.entity");
const storage_service_1 = require("../../common/storage/storage.service");
const orphan_sweep_1 = require("../../common/storage/orphan-sweep");
const logger_service_1 = require("../../common/services/logger.service");
exports.CHAT_MEDIA_PREFIX = 'chat-media/';
exports.DEFAULT_ARCHIVE_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_ORPHAN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_ORPHAN_GRACE_MS = 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 15 * 60 * 1000;
const PURGE_BATCH_SIZE = 500;
const PURGE_MAX_BATCHES_PER_RUN = 200;
const SWEEP_CHUNK_SIZE = 500;
const MIME_SUBTYPE_EXT_OVERRIDES = { jpeg: 'jpg', quicktime: 'mov' };
function extFromMimetype(mimetype) {
    const subtype = mimetype.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
    if (!subtype || !/^[a-z0-9]+$/.test(subtype))
        return 'bin';
    return MIME_SUBTYPE_EXT_OVERRIDES[subtype] ?? subtype;
}
const MEDIA_URL_POINTER = /^https?:\/\//i;
let ChatMediaArchiveService = class ChatMediaArchiveService {
    repository;
    storageService;
    configService;
    logger = (0, logger_service_1.createLogger)('ChatMediaArchiveService');
    purgeTimer;
    orphanSweepTimer;
    orphanFirstSeenAt = new Map();
    purgeCursor;
    purging = false;
    constructor(repository, storageService, configService) {
        this.repository = repository;
        this.storageService = storageService;
        this.configService = configService;
    }
    get enabled() {
        return this.configService.get('chatMedia.archiveEnabled', false);
    }
    get replacesInline() {
        return this.configService.get('chatMedia.inlineMode', 'inline') === 'archive';
    }
    onModuleInit() {
        const runPurge = () => {
            if (this.purging)
                return;
            this.purging = true;
            this.purgeExpired(Date.now())
                .catch(err => this.logger.error('Chat media purge failed', err instanceof Error ? err.stack : String(err)))
                .finally(() => (this.purging = false));
        };
        runPurge();
        this.purgeTimer = setInterval(runPurge, PURGE_INTERVAL_MS);
        this.purgeTimer.unref?.();
        const runOrphanSweep = () => {
            this.sweepOrphanedMedia(Date.now()).catch(err => this.logger.error('Chat media orphan sweep failed', err instanceof Error ? err.stack : String(err)));
        };
        runOrphanSweep();
        const sweepIntervalMs = this.configService.get('chatMedia.orphanSweepIntervalMs', DEFAULT_ORPHAN_SWEEP_INTERVAL_MS);
        this.orphanSweepTimer = setInterval(runOrphanSweep, sweepIntervalMs);
        this.orphanSweepTimer.unref?.();
    }
    onModuleDestroy() {
        if (this.purgeTimer)
            clearInterval(this.purgeTimer);
        if (this.orphanSweepTimer)
            clearInterval(this.orphanSweepTimer);
    }
    async archive(row) {
        if (!this.enabled)
            return null;
        if (row.mediaPath)
            return null;
        const media = row.metadata?.media;
        if (!media?.data || media.omitted || !media.mimetype)
            return null;
        if (MEDIA_URL_POINTER.test(media.data))
            return null;
        const maxBytes = this.configService.get('chatMedia.maxBytes', exports.DEFAULT_ARCHIVE_MAX_BYTES);
        const sizeBytes = Buffer.byteLength(media.data, 'base64');
        if (sizeBytes > maxBytes)
            return null;
        const key = `${exports.CHAT_MEDIA_PREFIX}${row.sessionId}/${(0, crypto_1.randomUUID)()}.${extFromMimetype(media.mimetype)}`;
        const bytes = Buffer.from(media.data, 'base64');
        try {
            await this.storageService.putFile(key, bytes);
        }
        catch (error) {
            this.logger.error(`Failed to archive chat media for session ${row.sessionId}, message ${row.id}`, error instanceof Error ? error.stack : String(error));
            return null;
        }
        try {
            let result;
            if (this.replacesInline) {
                const stored = await this.storageService.getFile(key);
                if (!stored.equals(bytes))
                    throw new Error('Archived media did not read back intact');
                const current = await this.repository.findOne({
                    where: { id: row.id, mediaPath: (0, typeorm_2.IsNull)(), type: (0, typeorm_2.Not)('revoked') },
                    select: { id: true, metadata: true, waMessageId: true },
                });
                const metadata = current?.metadata;
                const currentMedia = metadata?.media;
                if (!current?.waMessageId || !currentMedia?.data || currentMedia.data !== media.data) {
                    await this.storageService.deleteFile(key).catch(() => undefined);
                    return null;
                }
                const { data: _data, ...rest } = currentMedia;
                void _data;
                result = await this.repository
                    .createQueryBuilder()
                    .update()
                    .set({
                    mediaPath: key,
                    mediaMimetype: media.mimetype,
                    metadata: {
                        ...metadata,
                        media: { ...rest, omitted: true, sizeBytes: bytes.length, archived: true },
                    },
                })
                    .where({ id: row.id, type: (0, typeorm_2.Not)('revoked'), mediaPath: (0, typeorm_2.IsNull)() })
                    .andWhere('"metadata" = :snapshot', { snapshot: JSON.stringify(metadata) })
                    .execute();
            }
            else {
                result = await this.repository.update({ id: row.id, type: (0, typeorm_2.Not)('revoked'), mediaPath: (0, typeorm_2.IsNull)() }, { mediaPath: key, mediaMimetype: media.mimetype });
            }
            if (result.affected === 0) {
                await this.storageService.deleteFile(key).catch(() => undefined);
                return null;
            }
        }
        catch (error) {
            this.logger.warn(`Chat media ${key} written but not published; keeping inline media and leaving the file for the orphan sweep`, {
                error: String(error),
            });
            return null;
        }
        return key;
    }
    async getMedia(sessionId, chatIds, waMessageId) {
        const row = await this.repository.findOne({ where: { sessionId, chatId: (0, typeorm_2.In)(chatIds), waMessageId } });
        if (!row?.mediaPath || !row.mediaMimetype || row.type === 'revoked')
            return null;
        return { path: row.mediaPath, mimetype: row.mediaMimetype };
    }
    async purgeExpired(now) {
        const ttlDays = this.configService.get('chatMedia.ttlDays', 0);
        if (ttlDays <= 0)
            return 0;
        const cutoff = new Date(now - ttlDays * 24 * 60 * 60 * 1000);
        let cleared = 0;
        const isSqlite = ['sqlite', 'better-sqlite3'].includes(this.repository.manager.connection.options.type);
        let after = this.purgeCursor;
        this.purgeCursor = undefined;
        for (let batch = 0; batch < PURGE_MAX_BATCHES_PER_RUN; batch++) {
            const qb = this.repository
                .createQueryBuilder('m')
                .select(['m.id', 'm.mediaPath'])
                .where('m.mediaPath IS NOT NULL')
                .andWhere('m.createdAt < :cutoff', { cutoff });
            if (after)
                qb.andWhere('m.id > :after', { after });
            const expired = await qb
                .orderBy(isSqlite ? '+m.id' : 'm.id', 'ASC')
                .limit(PURGE_BATCH_SIZE)
                .getMany();
            if (expired.length === 0)
                break;
            after = expired[expired.length - 1].id;
            const clearableIds = [];
            for (const row of expired) {
                try {
                    await this.storageService.deleteFile(row.mediaPath);
                    clearableIds.push(row.id);
                }
                catch (err) {
                    this.logger.warn(`Failed to delete expired chat media ${row.mediaPath}; keeping the row for the next sweep`, {
                        error: String(err),
                    });
                }
            }
            if (clearableIds.length === 0) {
                this.purgeCursor = after;
                break;
            }
            await this.repository.update(clearableIds, {
                mediaPath: null,
                mediaMimetype: null,
            });
            cleared += clearableIds.length;
            if (expired.length < PURGE_BATCH_SIZE)
                break;
            if (batch === PURGE_MAX_BATCHES_PER_RUN - 1)
                this.purgeCursor = after;
        }
        if (cleared > 0)
            this.logger.log(`Chat media retention purge cleared ${cleared} file(s)`);
        return cleared;
    }
    async sweepOrphanedMedia(now = Date.now()) {
        const graceMs = this.configService.get('chatMedia.orphanGraceMs', DEFAULT_ORPHAN_GRACE_MS);
        const removed = await (0, orphan_sweep_1.sweepOrphanedFiles)({
            storage: this.storageService,
            prefix: exports.CHAT_MEDIA_PREFIX,
            graceMs,
            now,
            firstSeenAt: this.orphanFirstSeenAt,
            chunkSize: SWEEP_CHUNK_SIZE,
            referencedAmong: async (keys) => {
                const rows = await this.repository.find({ where: { mediaPath: (0, typeorm_2.In)(keys) }, select: { mediaPath: true } });
                return new Set(rows.map(row => row.mediaPath));
            },
            onDeleteFailed: (file, err) => this.logger.warn(`Failed to delete orphaned chat media ${file}`, { error: String(err) }),
        });
        if (removed > 0)
            this.logger.log(`Chat media orphan sweep removed ${removed} file(s)`);
        return removed;
    }
};
exports.ChatMediaArchiveService = ChatMediaArchiveService;
exports.ChatMediaArchiveService = ChatMediaArchiveService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(message_entity_1.Message, 'data')),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        storage_service_1.StorageService,
        config_1.ConfigService])
], ChatMediaArchiveService);
//# sourceMappingURL=chat-media-archive.service.js.map