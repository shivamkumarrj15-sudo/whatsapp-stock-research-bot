"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withPage = withPage;
exports.reportPageDeath = reportPageDeath;
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
const wwebjs_lifecycle_1 = require("./wwebjs-lifecycle");
async function withPage(host, context, op) {
    try {
        return await op();
    }
    catch (error) {
        if (host.isPageTransportError(error)) {
            host.reportIfPageTransportError(error, context);
            throw new engine_transport_error_1.EngineTransportError(`Transport died during ${context}`);
        }
        throw error;
    }
}
async function reportPageDeath(host, context, op) {
    try {
        return await op();
    }
    catch (error) {
        host.reportIfPageTransportError(error, context);
        const mapped = (0, wwebjs_lifecycle_1.toCapturedPageError)(error);
        if (mapped !== error) {
            host.logger.warn(`WhatsApp Web threw during ${context}`, {
                sessionId: host.config.sessionId,
                cause: error.message,
            });
        }
        throw mapped;
    }
}
//# sourceMappingURL=wwebjs-host.js.map