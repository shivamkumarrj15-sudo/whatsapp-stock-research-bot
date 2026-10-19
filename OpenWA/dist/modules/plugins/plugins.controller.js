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
exports.PluginsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const plugins_service_1 = require("./plugins.service");
const plugin_dto_1 = require("./dto/plugin.dto");
const auth_decorators_1 = require("../auth/decorators/auth.decorators");
const api_key_entity_1 = require("../auth/entities/api-key.entity");
const MAX_PLUGIN_UPLOAD_BYTES = 5 * 1024 * 1024;
let PluginsController = class PluginsController {
    pluginsService;
    constructor(pluginsService) {
        this.pluginsService = pluginsService;
    }
    findAll() {
        return this.pluginsService.findAll();
    }
    install(file) {
        return this.pluginsService.install(file);
    }
    async installFromUrl(dto) {
        return await this.pluginsService.installFromUrl(dto.url);
    }
    async catalog() {
        return await this.pluginsService.getCatalog();
    }
    findOne(id) {
        return this.pluginsService.findOne(id);
    }
    async enable(id) {
        return await this.pluginsService.enable(id);
    }
    async disable(id) {
        return await this.pluginsService.disable(id);
    }
    updateConfig(id, configDto) {
        return this.pluginsService.updateConfig(id, configDto.config);
    }
    getConfigUi(id) {
        return this.pluginsService.getConfigUiHtml(id);
    }
    updateSessionConfig(id, sessionId, configDto) {
        return this.pluginsService.updateSessionConfig(id, sessionId, configDto.config);
    }
    updateSessions(id, dto) {
        return this.pluginsService.updateSessions(id, dto.sessions);
    }
    async update(id, dto) {
        return await this.pluginsService.updateFromUrl(id, dto.url);
    }
    async uninstall(id) {
        return await this.pluginsService.uninstall(id);
    }
    async healthCheck(id) {
        return await this.pluginsService.healthCheck(id);
    }
};
exports.PluginsController = PluginsController;
__decorate([
    (0, common_1.Get)(),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: 'List all plugins' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'List of all plugins', type: plugin_dto_1.PluginDto, isArray: true }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], PluginsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)('install'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { limits: { fileSize: MAX_PLUGIN_UPLOAD_BYTES } })),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        required: true,
        schema: {
            type: 'object',
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary', description: 'The plugin .zip package' } },
        },
    }),
    (0, swagger_1.ApiOperation)({ summary: 'Install a plugin from an uploaded .zip package' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Plugin installed', type: plugin_dto_1.PluginDto }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Invalid package' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Plugin already installed' }),
    (0, swagger_1.ApiResponse)({ status: 413, description: 'Package exceeds the 5 MB upload limit' }),
    __param(0, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", plugin_dto_1.PluginDto)
], PluginsController.prototype, "install", null);
__decorate([
    (0, common_1.Post)('install-url'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: 'Install a plugin by downloading its .zip from a URL (SSRF-guarded)' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Plugin installed', type: plugin_dto_1.PluginDto }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Invalid URL, download failed, or invalid package' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Plugin already installed' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [plugin_dto_1.InstallFromUrlDto]),
    __metadata("design:returntype", Promise)
], PluginsController.prototype, "installFromUrl", null);
__decorate([
    (0, common_1.Get)('catalog'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: 'List the remote plugin catalog, annotated with install state' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Catalog entries', type: [plugin_dto_1.PluginCatalogEntryDto] }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Catalog could not be fetched or parsed' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PluginsController.prototype, "catalog", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: 'Get plugin by ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Plugin details', type: plugin_dto_1.PluginDto }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", plugin_dto_1.PluginDto)
], PluginsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(':id/enable'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Enable a plugin' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Plugin enabled successfully', type: plugin_dto_1.PluginActionResponseDto }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PluginsController.prototype, "enable", null);
__decorate([
    (0, common_1.Post)(':id/disable'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Disable a plugin' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Plugin disabled successfully', type: plugin_dto_1.PluginActionResponseDto }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PluginsController.prototype, "disable", null);
__decorate([
    (0, common_1.Put)(':id/config'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: 'Update plugin configuration' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Plugin configuration updated', type: plugin_dto_1.PluginActionResponseDto }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Validation failed, or the body carries a field the DTO does not declare.' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, plugin_dto_1.PluginConfigDto]),
    __metadata("design:returntype", Object)
], PluginsController.prototype, "updateConfig", null);
__decorate([
    (0, common_1.Get)(':id/config-ui'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, common_1.Header)('Content-Type', 'text/html; charset=utf-8'),
    (0, common_1.Header)('Content-Security-Policy', 'sandbox'),
    (0, common_1.Header)('X-Content-Type-Options', 'nosniff'),
    (0, swagger_1.ApiOperation)({ summary: "Serve a plugin's sandboxed config-UI entry HTML (for an iframe srcdoc)" }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Config UI HTML',
        content: { 'text/html': { schema: { type: 'string' } } },
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found or has no config UI' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", String)
], PluginsController.prototype, "getConfigUi", null);
__decorate([
    (0, common_1.Put)(':id/config/:sessionId'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Set a plugin config override for a specific session (empty = clear it)' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Per-session plugin configuration updated', type: plugin_dto_1.PluginActionResponseDto }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Plugin is global (not session-scoped), or the body failed validation' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('sessionId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, plugin_dto_1.PluginConfigDto]),
    __metadata("design:returntype", Object)
], PluginsController.prototype, "updateSessionConfig", null);
__decorate([
    (0, common_1.Put)(':id/sessions'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: "Set which sessions a session-scoped plugin is activated for (['*'] = all)" }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Plugin session activation updated', type: plugin_dto_1.PluginDto }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Plugin is global (not session-scoped), or the body failed validation' }),
    (0, swagger_1.ApiResponse)({
        status: 403,
        description: 'A session-restricted key may not replace the full active set — full activation replacement requires an unrestricted key',
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, plugin_dto_1.PluginSessionsDto]),
    __metadata("design:returntype", plugin_dto_1.PluginDto)
], PluginsController.prototype, "updateSessions", null);
__decorate([
    (0, common_1.Post)(':id/update'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: 'Update an installed plugin in place from a URL (preserves config + enabled state)' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Plugin updated', type: plugin_dto_1.PluginDto }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Invalid URL/package, id mismatch, or built-in' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    (0, swagger_1.ApiResponse)({
        status: 503,
        description: 'Gateway shutting down; the previous version was kept',
    }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, plugin_dto_1.InstallFromUrlDto]),
    __metadata("design:returntype", Promise)
], PluginsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: 'Uninstall a plugin (removes its files; built-ins are protected)' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Plugin uninstalled', type: plugin_dto_1.PluginActionResponseDto }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Cannot uninstall (e.g. built-in)' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PluginsController.prototype, "uninstall", null);
__decorate([
    (0, common_1.Get)(':id/health'),
    (0, auth_decorators_1.RequireRole)(api_key_entity_1.ApiKeyRole.ADMIN),
    (0, auth_decorators_1.RequireUnscopedKey)(),
    (0, swagger_1.ApiOperation)({ summary: 'Check plugin health' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Plugin health status', type: plugin_dto_1.PluginHealthResponseDto }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Plugin not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PluginsController.prototype, "healthCheck", null);
exports.PluginsController = PluginsController = __decorate([
    (0, swagger_1.ApiTags)('plugins'),
    (0, common_1.Controller)('plugins'),
    __metadata("design:paramtypes", [plugins_service_1.PluginsService])
], PluginsController);
//# sourceMappingURL=plugins.controller.js.map