"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePreflight = evaluatePreflight;
const whatsapp_engine_interface_1 = require("../../engine/interfaces/whatsapp-engine.interface");
const PREFLIGHT_RETRY_AFTER_SECONDS = 5;
function evaluatePreflight(route, sessionScope, sessionStatus) {
    const checks = route.response?.preflight;
    if (!checks?.length)
        return null;
    for (const check of checks) {
        if (check.type === 'session-alive') {
            if (!sessionScope || sessionScope === '*')
                continue;
            if (!sessionStatus)
                continue;
            const status = sessionStatus(sessionScope);
            if (status === undefined || status === whatsapp_engine_interface_1.EngineStatus.FAILED) {
                return {
                    status: 503,
                    body: 'session not ready',
                    headers: { 'Retry-After': String(PREFLIGHT_RETRY_AFTER_SECONDS) },
                };
            }
        }
    }
    return null;
}
//# sourceMappingURL=ingress-preflight.js.map