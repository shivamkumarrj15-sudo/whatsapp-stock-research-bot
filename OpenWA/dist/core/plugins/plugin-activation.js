"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPluginActiveForSession = isPluginActiveForSession;
exports.resolveInstanceConfig = resolveInstanceConfig;
exports.resolvePluginConfig = resolvePluginConfig;
function isPluginActiveForSession(sessionScoped, activeSessions, sessionId) {
    if (!sessionScoped)
        return true;
    if (sessionId === undefined)
        return true;
    if (activeSessions.includes('*'))
        return true;
    return activeSessions.includes(sessionId);
}
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function deepMerge(base, override) {
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const baseValue = out[key];
        out[key] = isPlainObject(baseValue) && isPlainObject(value) ? deepMerge(baseValue, value) : value;
    }
    return out;
}
function resolveInstanceConfig(resolved, instanceConfig) {
    return instanceConfig ? deepMerge(resolved, instanceConfig) : resolved;
}
function resolvePluginConfig(base, sessionConfig, sessionId, sessionScoped) {
    if (!sessionScoped || sessionId === undefined || !sessionConfig)
        return base;
    const override = sessionConfig[sessionId];
    return override ? deepMerge(base, override) : base;
}
//# sourceMappingURL=plugin-activation.js.map