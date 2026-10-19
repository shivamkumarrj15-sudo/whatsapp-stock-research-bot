"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BAILEYS_QUERY_BUDGET_MS = void 0;
exports.withQueryDeadline = withQueryDeadline;
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
async function withQueryDeadline(work, timeoutMs, detail) {
    let timer;
    work.catch(() => undefined);
    try {
        return await Promise.race([
            work,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new engine_transport_error_1.EngineTransportError(detail)), Math.max(0, timeoutMs));
                timer.unref?.();
            }),
        ]);
    }
    finally {
        clearTimeout(timer);
    }
}
exports.BAILEYS_QUERY_BUDGET_MS = 30_000;
//# sourceMappingURL=baileys-query-deadline.js.map