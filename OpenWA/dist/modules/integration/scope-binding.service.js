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
exports.ScopeBindingService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const audit_log_entity_1 = require("../audit/entities/audit-log.entity");
const audit_service_1 = require("../audit/audit.service");
const plugin_loader_service_1 = require("../../core/plugins/plugin-loader.service");
const session_entity_1 = require("../session/entities/session.entity");
const plugin_instance_service_1 = require("./plugin-instance.service");
const logger_service_1 = require("../../common/services/logger.service");
let ScopeBindingService = class ScopeBindingService {
    instances;
    loader;
    audit;
    sessions;
    logger = (0, logger_service_1.createLogger)('ScopeBindingService');
    constructor(instances, loader, audit, sessions) {
        this.instances = instances;
        this.loader = loader;
        this.audit = audit;
        this.sessions = sessions;
    }
    async onApplicationBootstrap() {
        try {
            await this.reconcile();
        }
        catch (err) {
            this.logger.error('Scope-binding reconciliation failed', String(err));
        }
    }
    async reconcile() {
        const rows = await this.instances.listAll();
        rows.sort((a, b) => {
            const rank = (i) => (!i.sessionScope || i.sessionScope === '*' ? 1 : 0);
            if (rank(a) !== rank(b))
                return rank(a) - rank(b);
            return String(a.instanceId).localeCompare(String(b.instanceId));
        });
        let count = 0;
        for (const inst of rows) {
            if (!inst.enabled)
                continue;
            if (!this.loader.getPlugin(inst.pluginId))
                continue;
            await this.applyScopeBinding(inst.pluginId, inst.sessionScope, inst.config ?? {}, true, { additive: true });
            await this.warnIfScopeHasNoSession(inst);
            count++;
        }
        if (count > 0) {
            this.logger.log(`Reconciled scope bindings for ${count} enabled plugin instance(s)`, {
                action: 'scope_bindings_reconciled',
                count,
            });
        }
    }
    async resyncAfterImport(previous) {
        const scopeKey = (scope) => (!scope || scope === '*' ? '*' : scope);
        const bound = new Set((await this.instances.listAll())
            .filter(row => row.enabled)
            .map(row => `${row.pluginId}\u0000${scopeKey(row.sessionScope)}`));
        const retired = new Map();
        for (const row of previous) {
            const key = `${row.pluginId}\u0000${scopeKey(row.sessionScope)}`;
            if (row.enabled && !bound.has(key))
                retired.set(key, row);
        }
        for (const { pluginId, sessionScope } of retired.values()) {
            if (!this.loader.getPlugin(pluginId))
                continue;
            await this.applyScopeBinding(pluginId, sessionScope, {}, false, { additive: true });
        }
        await this.reconcile();
    }
    async warnIfScopeHasNoSession(inst) {
        if (!inst.sessionScope || inst.sessionScope === '*')
            return;
        try {
            const session = await this.sessions.findOne({ where: { id: inst.sessionScope } });
            if (session)
                return;
            this.logger.warn(`Plugin instance ${inst.pluginId}:${inst.instanceId} is bound to session '${inst.sessionScope}', which does not exist — it will receive no events until that session is restored or the instance is re-scoped`, {
                action: 'scope_binding_session_missing',
                pluginId: inst.pluginId,
                instanceId: inst.instanceId,
                sessionScope: inst.sessionScope,
            });
        }
        catch {
        }
    }
    async applyScopeBinding(pluginId, scope, config, activate, opts = {}) {
        try {
            if (!scope || scope === '*') {
                if (activate) {
                    this.loader.updatePluginConfig(pluginId, config);
                    this.loader.setPluginSessions(pluginId, ['*']);
                    return;
                }
                const rows = await this.instances.list(pluginId);
                const anyWildcardLeft = rows.some(i => i.enabled && (!i.sessionScope || i.sessionScope === '*'));
                if (!anyWildcardLeft) {
                    const current = this.loader.getPlugin(pluginId)?.activeSessions ?? [];
                    const concrete = rows.filter(i => i.enabled && i.sessionScope).map(i => i.sessionScope);
                    this.loader.setPluginSessions(pluginId, [...new Set([...current.filter(s => s !== '*'), ...concrete])]);
                }
                return;
            }
            const siblings = await this.instances.list(pluginId);
            if (!activate && siblings.some(i => i.enabled && i.sessionScope === scope)) {
                this.loader.setPluginSessionConfig(pluginId, scope, {});
                return;
            }
            this.loader.setPluginSessionConfig(pluginId, scope, activate ? config : {});
            const current = this.loader.getPlugin(pluginId)?.activeSessions ?? [];
            const set = new Set(opts.additive ? current : current.filter(s => s !== '*'));
            if (!opts.additive && current.includes('*')) {
                for (const i of siblings)
                    if (i.enabled && i.sessionScope && i.sessionScope !== '*')
                        set.add(i.sessionScope);
            }
            if (activate)
                set.add(scope);
            else
                set.delete(scope);
            if (current.includes('*') && siblings.some(i => i.enabled && (!i.sessionScope || i.sessionScope === '*'))) {
                set.add('*');
            }
            this.loader.setPluginSessions(pluginId, [...set]);
        }
        catch (err) {
            void this.audit.logWarn(audit_log_entity_1.AuditAction.INTEGRATION_INSTANCE_UPDATED, {
                metadata: { pluginId, scope, bridgeError: String(err) },
            });
        }
    }
};
exports.ScopeBindingService = ScopeBindingService;
exports.ScopeBindingService = ScopeBindingService = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, typeorm_1.InjectRepository)(session_entity_1.Session, 'data')),
    __metadata("design:paramtypes", [plugin_instance_service_1.PluginInstanceService,
        plugin_loader_service_1.PluginLoaderService,
        audit_service_1.AuditService,
        typeorm_2.Repository])
], ScopeBindingService);
//# sourceMappingURL=scope-binding.service.js.map