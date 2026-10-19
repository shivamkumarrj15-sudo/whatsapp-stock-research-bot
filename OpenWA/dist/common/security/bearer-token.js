"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bearerToken = bearerToken;
function bearerToken(header) {
    return header ? /^bearer\s+(\S+)\s*$/i.exec(header)?.[1] : undefined;
}
//# sourceMappingURL=bearer-token.js.map