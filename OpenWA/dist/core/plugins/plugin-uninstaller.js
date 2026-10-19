"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginUninstaller = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class PluginUninstaller {
    logger;
    plugins;
    pluginStorage;
    pluginsDir;
    unload;
    legacyPluginsDir;
    releaseTakeovers;
    constructor(logger, plugins, pluginStorage, pluginsDir, unload, legacyPluginsDir = null, releaseTakeovers) {
        this.logger = logger;
        this.plugins = plugins;
        this.pluginStorage = pluginStorage;
        this.pluginsDir = pluginsDir;
        this.unload = unload;
        this.legacyPluginsDir = legacyPluginsDir;
        this.releaseTakeovers = releaseTakeovers;
    }
    unloadedDirs = new Map();
    resolveUninstallDir(root, pluginId) {
        const base = path.resolve(root);
        const dir = path.resolve(base, pluginId);
        return dir !== base && dir.startsWith(base + path.sep) ? dir : null;
    }
    async uninstallPlugin(pluginId) {
        if (this.pluginStorage.getPluginEntry(pluginId)?.builtIn) {
            throw new Error(`Cannot uninstall built-in plugin ${pluginId}`);
        }
        const recordedDir = this.plugins.get(pluginId)?.packageDir ?? this.unloadedDirs.get(pluginId) ?? null;
        if (recordedDir)
            this.unloadedDirs.set(pluginId, recordedDir);
        if (this.plugins.has(pluginId)) {
            await this.unload(pluginId);
        }
        await this.releaseTakeovers?.(pluginId);
        this.pluginStorage.deletePluginEntry(pluginId);
        const dir = recordedDir ?? this.resolveUninstallDir(this.pluginsDir, pluginId);
        if (dir && fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        if (this.legacyPluginsDir) {
            const legacyDir = this.resolveUninstallDir(this.legacyPluginsDir, pluginId);
            if (legacyDir && fs.existsSync(path.join(legacyDir, 'manifest.json'))) {
                fs.rmSync(legacyDir, { recursive: true, force: true });
            }
        }
        this.pluginStorage.deletePluginData(pluginId);
        this.unloadedDirs.delete(pluginId);
        this.logger.log(`Plugin uninstalled: ${pluginId}`, { pluginId, action: 'plugin_uninstalled' });
    }
}
exports.PluginUninstaller = PluginUninstaller;
//# sourceMappingURL=plugin-uninstaller.js.map