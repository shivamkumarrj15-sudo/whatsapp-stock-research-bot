"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripBase64DataUri = stripBase64DataUri;
exports.assertBase64WithinMediaCap = assertBase64WithinMediaCap;
const common_1 = require("@nestjs/common");
const engine_1 = require("../../engine");
function stripBase64DataUri(base64) {
    if (base64 == null)
        return undefined;
    const match = /^data:[^,]*;base64,/i.exec(base64);
    return match ? base64.slice(match[0].length) : base64;
}
function assertBase64WithinMediaCap(base64) {
    const normalized = stripBase64DataUri(base64);
    if (!normalized) {
        return;
    }
    const maxBytes = (0, engine_1.inboundMediaMaxBytes)();
    if (Buffer.byteLength(normalized, 'base64') > maxBytes) {
        throw new common_1.PayloadTooLargeException(`Base64 media exceeds the maximum allowed size of ${maxBytes} bytes`);
    }
}
//# sourceMappingURL=media-cap.util.js.map