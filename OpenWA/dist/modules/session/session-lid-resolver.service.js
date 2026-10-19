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
var SessionLidResolver_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionLidResolver = void 0;
const common_1 = require("@nestjs/common");
const engine_registry_service_1 = require("../../engine/engine-registry.service");
const lid_mapping_store_service_1 = require("../../engine/identity/lid-mapping-store.service");
const wa_id_1 = require("../../engine/identity/wa-id");
const lid_not_mapped_error_1 = require("../../common/errors/lid-not-mapped.error");
let SessionLidResolver = class SessionLidResolver {
    static { SessionLidResolver_1 = this; }
    engines;
    lidMappingStore;
    cache = new Map();
    static CACHE_MAX = 5000;
    retryAfter = new Map();
    static RETRY_AFTER_MS = 60_000;
    constructor(engines, lidMappingStore) {
        this.engines = engines;
        this.lidMappingStore = lidMappingStore;
    }
    async resolveSenderPhone(sessionId, contactId) {
        const key = `${sessionId}:${contactId}`;
        const cached = this.cache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        if ((this.retryAfter.get(key) ?? 0) > Date.now()) {
            return null;
        }
        let phone;
        let resolved = false;
        try {
            const engine = this.engines.get(sessionId);
            if (engine) {
                phone = (await engine.resolveContactPhone(contactId)) ?? null;
                resolved = true;
            }
            else {
                phone = null;
            }
        }
        catch (err) {
            phone = null;
            if (err instanceof lid_not_mapped_error_1.LidNotMappedError) {
                this.retryAfter.delete(key);
                if (this.retryAfter.size >= SessionLidResolver_1.CACHE_MAX) {
                    this.retryAfter.delete(this.retryAfter.keys().next().value);
                }
                this.retryAfter.set(key, Date.now() + SessionLidResolver_1.RETRY_AFTER_MS);
            }
        }
        if (resolved) {
            this.retryAfter.delete(key);
            if (this.cache.size >= SessionLidResolver_1.CACHE_MAX) {
                for (const oldest of this.cache.keys()) {
                    this.cache.delete(oldest);
                    break;
                }
            }
            this.cache.set(key, phone);
        }
        if (phone || resolved) {
            void this.lidMappingStore?.remember((0, wa_id_1.userPart)(contactId), phone, sessionId)?.catch(() => { });
        }
        return phone;
    }
};
exports.SessionLidResolver = SessionLidResolver;
exports.SessionLidResolver = SessionLidResolver = SessionLidResolver_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [engine_registry_service_1.EngineRegistry,
        lid_mapping_store_service_1.LidMappingStoreService])
], SessionLidResolver);
//# sourceMappingURL=session-lid-resolver.service.js.map