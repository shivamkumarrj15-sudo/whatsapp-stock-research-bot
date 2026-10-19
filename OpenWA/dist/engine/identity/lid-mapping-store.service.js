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
exports.LidMappingStoreService = exports.LID_MAPPING_CACHE_DEFAULT = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const lid_mapping_entity_1 = require("./lid-mapping.entity");
const wa_id_1 = require("./wa-id");
const logger_service_1 = require("../../common/services/logger.service");
const configuration_1 = require("../../config/configuration");
exports.LID_MAPPING_CACHE_DEFAULT = 5000;
const LID_QUERY_CHUNK = 500;
function chunk(items, size = LID_QUERY_CHUNK) {
    const out = [];
    for (let i = 0; i < items.length; i += size)
        out.push(items.slice(i, i + size));
    return out;
}
let LidMappingStoreService = class LidMappingStoreService {
    repo;
    logger = (0, logger_service_1.createLogger)('LidMappingStore');
    lidToPhone = new Map();
    phoneToLids = new Map();
    pendingLookups = new Set();
    absentFromTable = new Set();
    unsettledWrites = new Map();
    racedLookups = new Set();
    maxCachedLids;
    constructor(repo) {
        this.repo = repo;
        this.maxCachedLids = (0, configuration_1.resolveNonNegativeIntEnv)(process.env.LID_MAPPING_CACHE_MAX, exports.LID_MAPPING_CACHE_DEFAULT);
    }
    async onModuleInit() {
        await this.reload();
    }
    async reload() {
        this.absentFromTable.clear();
        try {
            const rows = await this.repo.find({
                order: { updatedAt: 'DESC' },
                take: this.maxCachedLids > 0 ? this.maxCachedLids : undefined,
            });
            this.lidToPhone.clear();
            this.phoneToLids.clear();
            this.absentFromTable.clear();
            for (const row of rows.reverse()) {
                this.index(row.lid, row.phone);
            }
            this.logger.log(`Loaded ${rows.length} lid->phone mappings into cache${this.maxCachedLids ? ` (cap ${this.maxCachedLids})` : ''}`);
        }
        catch (err) {
            this.logger.warn(`Could not preload lid->phone mappings: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    getCached(lid) {
        if (this.lidToPhone.has(lid)) {
            const phone = this.lidToPhone.get(lid);
            this.lidToPhone.delete(lid);
            this.lidToPhone.set(lid, phone);
            return phone;
        }
        this.warmFromTable(lid);
        return undefined;
    }
    resolveLid(jid) {
        return this.getCached((0, wa_id_1.userPart)(jid)) ?? null;
    }
    lidsForPhone(phone) {
        const set = this.phoneToLids.get(phone);
        return set ? [...set] : [];
    }
    async findLidsForPhone(phone) {
        try {
            return (await this.readLidsForPhones([phone]))[phone];
        }
        catch (err) {
            this.logger.warn(`Could not read lids for a phone: ${err instanceof Error ? err.message : String(err)}`);
            return this.lidsForPhone(phone);
        }
    }
    async phonesForLidsPersisted(lids) {
        const out = {};
        if (lids.length === 0)
            return out;
        for (const lid of lids)
            out[lid] = this.getCached(lid) ?? null;
        try {
            for (const batch of chunk(lids)) {
                const rows = await this.repo.find({ where: { lid: (0, typeorm_2.In)(batch) } });
                for (const row of rows)
                    out[row.lid] = row.phone;
            }
        }
        catch {
        }
        return out;
    }
    async lidsForPhonesPersisted(phones) {
        try {
            return await this.readLidsForPhones(phones);
        }
        catch {
            return Object.fromEntries(phones.map(phone => [phone, this.lidsForPhone(phone)]));
        }
    }
    async readLidsForPhones(phones) {
        const out = {};
        for (const phone of phones)
            out[phone] = new Set(this.lidsForPhone(phone));
        const cachedLids = [...new Set(phones.flatMap(phone => [...out[phone]]))];
        for (const batch of chunk(cachedLids)) {
            for (const row of await this.repo.find({ where: { lid: (0, typeorm_2.In)(batch) } })) {
                for (const phone of phones)
                    if (row.phone !== phone)
                        out[phone].delete(row.lid);
            }
        }
        for (const batch of chunk(phones)) {
            for (const { lid, phone } of await this.repo.find({ where: { phone: (0, typeorm_2.In)(batch) } })) {
                if (!phone || !out[phone])
                    continue;
                const cached = this.lidToPhone.get(lid);
                if (cached === undefined || cached === phone)
                    out[phone].add(lid);
            }
        }
        return Object.fromEntries(phones.map(phone => [phone, [...out[phone]]]));
    }
    async findPhoneForLid(jid) {
        const lid = (0, wa_id_1.userPart)(jid);
        try {
            const row = await this.repo.findOne({ where: { lid } });
            if (row)
                return row.phone;
        }
        catch (err) {
            this.logger.warn(`Could not read the phone for a lid: ${err instanceof Error ? err.message : String(err)}`);
        }
        return this.getCached(lid) ?? null;
    }
    async remember(lid, phone, sessionId) {
        if (!lid || this.lidToPhone.get(lid) === phone) {
            return;
        }
        this.index(lid, phone);
        this.unsettledWrites.set(lid, (this.unsettledWrites.get(lid) ?? 0) + 1);
        if (this.pendingLookups.has(lid))
            this.racedLookups.add(lid);
        try {
            await this.repo.upsert({ lid, phone, sessionId: sessionId ?? null, updatedAt: new Date() }, ['lid']);
        }
        catch (err) {
            this.logger.warn(`Failed to persist lid->phone mapping for ${lid}: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            const left = (this.unsettledWrites.get(lid) ?? 1) - 1;
            if (left > 0)
                this.unsettledWrites.set(lid, left);
            else
                this.unsettledWrites.delete(lid);
        }
    }
    warmFromTable(lid) {
        if (!lid || this.pendingLookups.has(lid) || this.absentFromTable.has(lid))
            return;
        this.pendingLookups.add(lid);
        const writeInFlight = this.unsettledWrites.has(lid);
        void this.repo
            .findOne({ where: { lid } })
            .then(row => {
            if (writeInFlight || this.racedLookups.has(lid))
                return;
            if (row && !this.lidToPhone.has(row.lid)) {
                this.index(row.lid, row.phone);
                return;
            }
            if (!row && !this.lidToPhone.has(lid))
                this.noteAbsent(lid);
        })
            .catch(() => undefined)
            .finally(() => {
            this.pendingLookups.delete(lid);
            this.racedLookups.delete(lid);
        });
    }
    index(lid, phone) {
        const prev = this.lidToPhone.get(lid);
        if (prev && prev !== phone) {
            this.unindex(lid, prev);
        }
        this.lidToPhone.delete(lid);
        this.lidToPhone.set(lid, phone);
        if (phone) {
            const set = this.phoneToLids.get(phone) ?? new Set();
            set.add(lid);
            this.phoneToLids.set(phone, set);
        }
        this.absentFromTable.delete(lid);
        this.evictIfOverCap();
    }
    noteAbsent(lid) {
        if (!this.maxCachedLids)
            return;
        this.absentFromTable.add(lid);
        while (this.absentFromTable.size > this.maxCachedLids) {
            const oldest = this.absentFromTable.values().next().value;
            if (oldest === undefined)
                break;
            this.absentFromTable.delete(oldest);
        }
    }
    evictIfOverCap() {
        if (!this.maxCachedLids)
            return;
        while (this.lidToPhone.size > this.maxCachedLids) {
            const oldest = this.lidToPhone.keys().next().value;
            if (oldest === undefined)
                break;
            const phone = this.lidToPhone.get(oldest);
            this.lidToPhone.delete(oldest);
            if (phone)
                this.unindex(oldest, phone);
        }
    }
    unindex(lid, phone) {
        const set = this.phoneToLids.get(phone);
        if (set?.delete(lid) && set.size === 0)
            this.phoneToLids.delete(phone);
    }
};
exports.LidMappingStoreService = LidMappingStoreService;
exports.LidMappingStoreService = LidMappingStoreService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(lid_mapping_entity_1.LidMapping, 'data')),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], LidMappingStoreService);
//# sourceMappingURL=lid-mapping-store.service.js.map