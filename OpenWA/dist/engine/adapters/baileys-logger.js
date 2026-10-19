"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSilentLogger = createSilentLogger;
exports.createBaileysLogger = createBaileysLogger;
function createSilentLogger() {
    const noop = () => { };
    const logger = {
        level: 'silent',
        child: () => logger,
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
    };
    return logger;
}
const SECRET_KEYS = new Set(['password', 'secret', 'token', 'apikey', 'api_key', 'authorization']);
function redactSecrets(value, depth = 0) {
    if (depth > 4 || value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(v => redactSecrets(v, depth + 1));
    if (value instanceof Error) {
        const own = redactSecrets({ ...value }, depth);
        return { name: value.name, message: value.message, stack: value.stack, ...own };
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [
        k,
        SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : redactSecrets(v, depth + 1),
    ]));
}
const BAILEYS_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];
function createBaileysLogger() {
    const configured = (process.env.BAILEYS_LOG_LEVEL ?? 'silent').toLowerCase();
    if (!BAILEYS_LOG_LEVELS.includes(configured)) {
        return createSilentLogger();
    }
    const threshold = BAILEYS_LOG_LEVELS.indexOf(configured);
    const write = (lvl) => (obj, msg) => {
        if (BAILEYS_LOG_LEVELS.indexOf(lvl) < threshold) {
            return;
        }
        const rec = typeof obj === 'string'
            ? { msg: obj }
            : { ...redactSecrets(obj), ...(msg ? { msg } : {}) };
        process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level: lvl, context: 'baileys-wire', ...rec }) + '\n');
    };
    const logger = {
        level: configured,
        child: () => logger,
        trace: write('trace'),
        debug: write('debug'),
        info: write('info'),
        warn: write('warn'),
        error: write('error'),
    };
    return logger;
}
//# sourceMappingURL=baileys-logger.js.map