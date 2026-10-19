"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeSecretFile = writeSecretFile;
const fs_1 = require("fs");
function writeSecretFile(filePath, content) {
    try {
        (0, fs_1.chmodSync)(filePath, 0o600);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`[OpenWA] pre-write chmod 0o600 failed for ${filePath}: ${error.message}`);
        }
    }
    (0, fs_1.writeFileSync)(filePath, content, { mode: 0o600 });
    try {
        (0, fs_1.chmodSync)(filePath, 0o600);
    }
    catch (error) {
        console.warn(`[OpenWA] post-write chmod 0o600 failed for ${filePath}: ${error.message}`);
    }
}
//# sourceMappingURL=secret-file.js.map