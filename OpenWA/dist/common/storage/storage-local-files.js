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
exports.listLocalFiles = listLocalFiles;
exports.iterateLocalFiles = iterateLocalFiles;
exports.getLocalFile = getLocalFile;
exports.openLocalFile = openLocalFile;
exports.putLocalFile = putLocalFile;
exports.deleteLocalFile = deleteLocalFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const path_safety_1 = require("../utils/path-safety");
const DEFAULT_LIST_MAX_FILES = 100_000;
const LOCAL_TRAVERSAL_MAX_DEPTH = 20;
function positiveIntFromEnv(name, fallback) {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
async function listLocalFiles(localPath) {
    const maxFiles = positiveIntFromEnv('STORAGE_LIST_MAX_FILES', DEFAULT_LIST_MAX_FILES);
    const files = [];
    for await (const file of iterateLocalFiles(localPath)) {
        files.push(file);
        if (files.length >= maxFiles)
            break;
    }
    return files;
}
async function* iterateLocalFiles(localPath, prefix = '') {
    const root = prefix.endsWith('/') ? prefix.slice(0, -1) : '';
    if (root && !(0, path_safety_1.isPathWithin)(localPath, root))
        return;
    const queue = [{ dir: root, depth: 0 }];
    while (queue.length > 0) {
        const { dir, depth } = queue.shift();
        if (depth >= LOCAL_TRAVERSAL_MAX_DEPTH) {
            throw new Error(`Storage directory exceeds the maximum traversal depth: ${dir}`);
        }
        const fullPath = path.join(localPath, dir);
        let entries;
        try {
            entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            continue;
        }
        for (const entry of entries) {
            const relativePath = dir ? path.join(dir, entry.name) : entry.name;
            if (entry.isDirectory()) {
                queue.push({ dir: relativePath, depth: depth + 1 });
            }
            else if (entry.isFile()) {
                yield relativePath;
            }
        }
    }
}
function getLocalFile(localPath, filePath) {
    if (!(0, path_safety_1.isPathWithin)(localPath, filePath)) {
        throw new Error(`Refusing to read outside storage root: ${filePath}`);
    }
    const fullPath = path.join(localPath, filePath);
    return fs.promises.readFile(fullPath);
}
async function openLocalFile(localPath, filePath) {
    if (!(0, path_safety_1.isPathWithin)(localPath, filePath)) {
        throw new Error(`Refusing to read outside storage root: ${filePath}`);
    }
    const handle = await fs.promises.open(path.join(localPath, filePath), 'r');
    try {
        const { size } = await handle.stat();
        return { stream: handle.createReadStream(), size };
    }
    catch (error) {
        await handle.close();
        throw error;
    }
}
async function putLocalFile(localPath, filePath, data) {
    if (!(0, path_safety_1.isPathWithin)(localPath, filePath)) {
        throw new Error(`Refusing to write outside storage root: ${filePath}`);
    }
    const fullPath = path.join(localPath, filePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, data);
}
async function deleteLocalFile(localPath, filePath) {
    if (!(0, path_safety_1.isPathWithin)(localPath, filePath)) {
        throw new Error(`Refusing to delete outside storage root: ${filePath}`);
    }
    const fullPath = path.join(localPath, filePath);
    try {
        await fs.promises.unlink(fullPath);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
}
//# sourceMappingURL=storage-local-files.js.map