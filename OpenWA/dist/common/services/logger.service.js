"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var LoggerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggerService = exports.LogFormat = exports.LogLevel = void 0;
exports.createLogger = createLogger;
const common_1 = require("@nestjs/common");
const request_context_1 = require("./request-context");
var LogLevel;
(function (LogLevel) {
    LogLevel["ERROR"] = "error";
    LogLevel["WARN"] = "warn";
    LogLevel["INFO"] = "info";
    LogLevel["DEBUG"] = "debug";
    LogLevel["VERBOSE"] = "verbose";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
var LogFormat;
(function (LogFormat) {
    LogFormat["JSON"] = "json";
    LogFormat["PRETTY"] = "pretty";
})(LogFormat || (exports.LogFormat = LogFormat = {}));
const SECRET_KEY_PATTERN = /password|passwd|secret|token|api[-_]?key|authorization|credential|pepper|private[-_]?key/i;
function redactSecrets(value, depth = 0) {
    if (value === null || typeof value !== 'object' || depth > 4)
        return value;
    if (Array.isArray(value))
        return value.map(v => redactSecrets(v, depth + 1));
    const out = {};
    for (const [key, val] of Object.entries(value)) {
        out[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecrets(val, depth + 1);
    }
    return out;
}
function stringifyMessage(message) {
    try {
        return JSON.stringify(redactSecrets(message)) ?? String(message);
    }
    catch {
        return String(message);
    }
}
const ANSI = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};
const LEVEL_COLOR = {
    [LogLevel.ERROR]: ANSI.red,
    [LogLevel.WARN]: ANSI.yellow,
    [LogLevel.INFO]: ANSI.green,
    [LogLevel.DEBUG]: ANSI.magenta,
    [LogLevel.VERBOSE]: ANSI.cyan,
};
const LEVEL_LABEL = {
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.INFO]: 'LOG',
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.VERBOSE]: 'VERBOSE',
};
const STRUCTURAL_KEYS = new Set(['timestamp', 'level', 'context', 'message', 'trace']);
let LoggerService = class LoggerService {
    static { LoggerService_1 = this; }
    context = 'Application';
    static logLevel = LogLevel.INFO;
    static logFormat = null;
    static setLogLevel(level) {
        LoggerService_1.logLevel = level;
    }
    static setLogFormat(format) {
        LoggerService_1.logFormat = format;
    }
    setContext(context) {
        this.context = context;
    }
    log(message, context) {
        this.writeLog(LogLevel.INFO, message, context);
    }
    error(message, trace, context) {
        this.writeLog(LogLevel.ERROR, message, context, trace);
    }
    fatal(message, context) {
        this.writeLog(LogLevel.ERROR, message, context);
    }
    warn(message, context) {
        this.writeLog(LogLevel.WARN, message, context);
    }
    debug(message, context) {
        this.writeLog(LogLevel.DEBUG, message, context);
    }
    verbose(message, context) {
        this.writeLog(LogLevel.VERBOSE, message, context);
    }
    writeLog(level, rawMessage, context, rawTrace) {
        if (!this.shouldLog(level))
            return;
        if (rawMessage instanceof Error) {
            rawTrace ??= rawMessage.stack;
            rawMessage = rawMessage.message;
        }
        const message = typeof rawMessage === 'string' ? rawMessage : stringifyMessage(rawMessage);
        const trace = rawTrace === undefined || typeof rawTrace === 'string'
            ? rawTrace
            : rawTrace instanceof Error
                ? (rawTrace.stack ?? rawTrace.message)
                : stringifyMessage(rawTrace);
        const timestamp = new Date().toISOString();
        const contextName = typeof context === 'string' ? context : this.context;
        const metadata = typeof context === 'object' && context !== null ? redactSecrets(context) : {};
        const requestId = (0, request_context_1.getRequestId)();
        const logEntry = {
            timestamp,
            level,
            context: contextName,
            message,
            ...Object.fromEntries(Object.entries(metadata).filter(([key]) => !STRUCTURAL_KEYS.has(key) && key !== 'requestId')),
            ...(trace !== undefined ? { trace } : {}),
            ...(requestId ? { requestId } : {}),
        };
        const output = LoggerService_1.resolveFormat() === LogFormat.PRETTY
            ? this.formatPretty(level, logEntry)
            : JSON.stringify(logEntry);
        switch (level) {
            case LogLevel.ERROR:
                console.error(output);
                break;
            case LogLevel.WARN:
                console.warn(output);
                break;
            default:
                console.log(output);
        }
    }
    formatPretty(level, entry) {
        const useColor = LoggerService_1.colorEnabled();
        const paint = (code, text) => (useColor ? `${code}${text}${ANSI.reset}` : text);
        const levelColor = LEVEL_COLOR[level];
        const label = LEVEL_LABEL[level].padStart(7);
        const timestamp = new Date(String(entry.timestamp)).toLocaleString();
        const contextName = String(entry.context);
        const message = String(entry.message);
        const formatValue = (value) => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));
        const meta = Object.entries(entry)
            .filter(([key, value]) => !STRUCTURAL_KEYS.has(key) && value !== undefined)
            .map(([key, value]) => `${key}=${formatValue(value)}`)
            .join(' ');
        let line = `${paint(levelColor, `[OpenWA] ${process.pid}  -`)} ${timestamp} ` +
            `${paint(levelColor, label)} ${paint(ANSI.yellow, `[${contextName}]`)} ${paint(levelColor, message)}`;
        if (meta) {
            line += ` ${paint(ANSI.dim, meta)}`;
        }
        if (typeof entry.trace === 'string' && entry.trace) {
            line += `\n${paint(levelColor, entry.trace)}`;
        }
        return line;
    }
    static resolveFormat() {
        if (LoggerService_1.logFormat)
            return LoggerService_1.logFormat;
        const explicit = process.env.LOG_FORMAT?.trim().toLowerCase();
        if (explicit === LogFormat.JSON || explicit === LogFormat.PRETTY) {
            return explicit;
        }
        return process.env.NODE_ENV === 'production' ? LogFormat.JSON : LogFormat.PRETTY;
    }
    static colorEnabled() {
        if (process.env.NO_COLOR)
            return false;
        if (process.env.FORCE_COLOR)
            return true;
        return Boolean(process.stdout.isTTY);
    }
    shouldLog(level) {
        const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG, LogLevel.VERBOSE];
        const currentIndex = levels.indexOf(LoggerService_1.logLevel);
        const targetIndex = levels.indexOf(level);
        return targetIndex <= currentIndex;
    }
};
exports.LoggerService = LoggerService;
exports.LoggerService = LoggerService = LoggerService_1 = __decorate([
    (0, common_1.Injectable)({ scope: common_1.Scope.TRANSIENT })
], LoggerService);
function createLogger(context) {
    const logger = new LoggerService();
    logger.setContext(context);
    return logger;
}
//# sourceMappingURL=logger.service.js.map