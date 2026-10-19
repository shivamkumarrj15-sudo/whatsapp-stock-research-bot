"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var BuiltInFtsProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuiltInFtsProvider = void 0;
const common_1 = require("@nestjs/common");
const logger_service_1 = require("../../../common/services/logger.service");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const search_constants_1 = require("../search.constants");
const MAX_SNIPPET_WORDS = 24;
let BuiltInFtsProvider = class BuiltInFtsProvider {
    static { BuiltInFtsProvider_1 = this; }
    dataSource;
    id = 'builtin-fts';
    label = 'Built-in database full-text search';
    logger = (0, logger_service_1.createLogger)('BuiltInFtsProvider');
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async onModuleInit() {
        try {
            this.ftsAvailable = await this.ensureFtsSchema();
            if (this.ftsAvailable) {
                this.logger.log('FTS index ready');
            }
            else {
                this.logger.warn('FTS index unavailable (SQLite built without FTS5); /api/search will return 501');
            }
        }
        catch (e) {
            this.logger.error(`Failed to ensure FTS schema: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    ftsAvailable = null;
    async probeFts() {
        if (this.ftsAvailable !== null)
            return this.ftsAvailable;
        if (this.dataSource.options.type === 'postgres') {
            let rows;
            try {
                rows = await this.dataSource.query(`SELECT a.attname FROM pg_attribute a WHERE a.attrelid = to_regclass('messages') AND a.attname = 'body_ts' AND NOT a.attisdropped`);
            }
            catch (e) {
                this.logger.warn(`FTS probe failed; treating the index as unavailable: ${e instanceof Error ? e.message : String(e)}`);
                return false;
            }
            this.ftsAvailable = Array.isArray(rows) && rows.length >= 1;
        }
        else {
            const rows = await this.dataSource.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'`);
            this.ftsAvailable = Array.isArray(rows) && rows.length === 1;
        }
        return this.ftsAvailable;
    }
    async ensureFts() {
        const ok = await this.probeFts();
        if (!ok) {
            throw new common_1.NotImplementedException('Search is unavailable: the database has no full-text index.');
        }
    }
    async ensureFtsSchema() {
        const isPostgres = this.dataSource.options.type === 'postgres';
        if (isPostgres) {
            const rows = await this.dataSource.query(`SELECT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('messages') AND a.attname = 'body_ts' AND NOT a.attisdropped) AS col,
                EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = to_regclass('messages') AND c.relname = 'idx_messages_body_ts') AS idx`);
            if (!rows[0]?.col) {
                await this.dataSource.query(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "body_ts" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED`);
            }
            if (!rows[0]?.idx) {
                await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "idx_messages_body_ts" ON "messages" USING GIN ("body_ts")`);
            }
            return true;
        }
        const fts5 = await this.dataSource.query(`SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled`);
        if (!Number(fts5[0]?.enabled))
            return false;
        await this.dataSource.query(`CREATE VIRTUAL TABLE IF NOT EXISTS "messages_fts" USING fts5(body, content='messages', content_rowid='rowid')`);
        const orphanRow = await this.dataSource.query(`SELECT EXISTS(SELECT 1 FROM "messages_fts_docsize" d
         WHERE NOT EXISTS (SELECT 1 FROM "messages" m WHERE m."rowid" = d."rowid")) AS orphan`);
        if (Number(orphanRow[0]?.orphan)) {
            this.logger.warn('FTS index holds rows the messages table no longer has; re-indexing every message');
            await this.dataSource.query(`INSERT INTO "messages_fts"("messages_fts") VALUES ('delete-all')`);
        }
        const gapRow = await this.dataSource.query(`SELECT EXISTS(SELECT 1 FROM "messages" m WHERE m."body" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "messages_fts_docsize" d WHERE d."rowid" = m."rowid")) AS missing`);
        if (Number(gapRow[0]?.missing)) {
            await this.dataSource.query(`INSERT INTO "messages_fts"("rowid", "body")
           SELECT m."rowid", m."body" FROM "messages" m WHERE m."body" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "messages_fts_docsize" d WHERE d."rowid" = m."rowid")`);
        }
        await this.dataSource.query(`DROP TRIGGER IF EXISTS messages_fts_ai`);
        await this.dataSource.query(`CREATE TRIGGER messages_fts_ai AFTER INSERT ON "messages" BEGIN
      INSERT INTO "messages_fts"("rowid", "body") VALUES (new."rowid", new."body");
    END`);
        await this.dataSource.query(`DROP TRIGGER IF EXISTS messages_fts_ad`);
        await this.dataSource.query(`CREATE TRIGGER messages_fts_ad AFTER DELETE ON "messages" BEGIN
      INSERT INTO "messages_fts"("messages_fts", "rowid", "body") VALUES ('delete', old."rowid", old."body");
    END`);
        await this.dataSource.query(`DROP TRIGGER IF EXISTS messages_fts_au`);
        await this.dataSource.query(`CREATE TRIGGER messages_fts_au AFTER UPDATE ON "messages" WHEN OLD.body IS NOT NEW.body BEGIN
      INSERT INTO "messages_fts"("messages_fts", "rowid", "body") VALUES ('delete', old."rowid", old."body");
      INSERT INTO "messages_fts"("rowid", "body") VALUES (new."rowid", new."body");
    END`);
        return true;
    }
    async search(query) {
        await this.ensureFts();
        const start = Date.now();
        const isPostgres = this.dataSource.options.type === 'postgres';
        const limit = Math.max(1, Math.min(query.limit ?? 50, search_constants_1.SEARCH_LIMIT_MAX));
        const offset = Math.max(0, query.offset ?? 0);
        const { sql, params } = isPostgres
            ? this.buildPostgres(query, limit, offset)
            : this.buildSqlite(query, limit, offset);
        const fts5QueryError = /(fts5:\s*syntax\s*error|unterminated\s+string|unknown\s+special\s+query)/i;
        let rows;
        try {
            rows = await this.dataSource.query(sql, params);
        }
        catch (e) {
            if (!isPostgres && fts5QueryError.test(String(e))) {
                throw new common_1.BadRequestException('Malformed search query for SQLite full-text search.');
            }
            throw e;
        }
        const hits = rows.map(r => this.mapRow(r));
        const total = rows.length < limit && offset === 0 ? rows.length : await this.count(query, isPostgres);
        return { hits, total, tookMs: Date.now() - start, provider: this.id };
    }
    async health() {
        try {
            const ok = await this.probeFts();
            return { ok, detail: ok ? undefined : 'full-text index absent' };
        }
        catch (e) {
            return { ok: false, detail: e instanceof Error ? e.message : String(e) };
        }
    }
    mapRow(r) {
        return {
            messageId: r.id,
            waMessageId: r.wa_message_id ?? '',
            sessionId: r.session_id,
            chatId: r.chat_id,
            body: r.body ?? '',
            snippet: r.snippet ?? '',
            timestamp: Number(r.timestamp ?? 0),
            type: r.type,
            direction: r.direction,
            from: r.from,
            score: r.score == null ? undefined : Number(r.score),
        };
    }
    static sqlitePlaceholder = () => '?';
    pgPlaceholder() {
        let n = 0;
        return () => `$${++n}`;
    }
    static toFts5Query(raw) {
        const tokens = [...new Set(raw.trim().split(/\s+/).filter(Boolean))];
        if (tokens.length === 0)
            return '""';
        return tokens.map(tok => `"${tok.replace(/"/g, '""')}"`).join(' ');
    }
    buildSqlite(q, limit, offset) {
        const ph = BuiltInFtsProvider_1.sqlitePlaceholder;
        const params = [];
        const where = [`messages_fts MATCH ${ph()}`];
        params.push(BuiltInFtsProvider_1.toFts5Query(q.q));
        this.applyFilters(where, params, q, 'm.', ph);
        const scoped = q.chatIds !== undefined || (q.sessionIds?.length ?? 0) > 0;
        const score = scoped ? 'NULL' : 'rank';
        const cols = `m."id", m."waMessageId" AS wa_message_id, m."sessionId" AS session_id, m."chatId" AS chat_id, m."from" AS "from", m."body", m."timestamp", m."type", m."direction", snippet(messages_fts, 0, '<mark>', '</mark>', '…', ${MAX_SNIPPET_WORDS}) AS snippet, ${score} AS score`;
        const sql = `SELECT ${cols} FROM messages_fts JOIN messages m ON m."rowid" = messages_fts."rowid" WHERE ${where.join(' AND ')} ORDER BY rank, m."timestamp" DESC, m."id" DESC LIMIT ${ph()} OFFSET ${ph()}`;
        params.push(limit, offset);
        return { sql, params };
    }
    buildPostgres(q, limit, offset) {
        const ph = this.pgPlaceholder();
        const params = [];
        const ftsTerm = `websearch_to_tsquery('simple', ${ph()}) AS q(query)`;
        params.push(q.q);
        const where = [`m.body_ts @@ q.query`];
        this.applyFilters(where, params, q, 'm.', ph);
        const cols = `m."id", m."waMessageId" AS wa_message_id, m."sessionId" AS session_id, m."chatId" AS chat_id, m."from", m."body", m."timestamp", m."type", m."direction", ts_headline('simple', m."body", q.query, 'MaxFragments=1, MaxWords=${MAX_SNIPPET_WORDS}, StartSel=<mark>, StopSel=</mark>') AS snippet, ts_rank(m.body_ts, q.query) AS score`;
        const sql = `SELECT ${cols} FROM messages m, ${ftsTerm} WHERE ${where.join(' AND ')} ORDER BY score DESC, m."timestamp" DESC, m."id" DESC LIMIT ${ph()} OFFSET ${ph()}`;
        params.push(limit, offset);
        return { sql, params };
    }
    applyFilters(where, params, q, prefix, ph) {
        if (q.sessionIds && q.sessionIds.length) {
            const placeholders = q.sessionIds.map(() => ph()).join(',');
            where.push(`${prefix}"sessionId" IN (${placeholders})`);
            params.push(...q.sessionIds);
        }
        if (q.sessionId) {
            where.push(`${prefix}"sessionId" = ${ph()}`);
            params.push(q.sessionId);
        }
        if (q.chatId) {
            where.push(`${prefix}"chatId" = ${ph()}`);
            params.push(q.chatId);
        }
        if (q.chatIds?.length === 0)
            where.push('1 = 0');
        else if (q.chatIds) {
            const placeholders = q.chatIds.map(() => ph()).join(',');
            where.push(`${prefix}"chatId" IN (${placeholders})`);
            params.push(...q.chatIds);
        }
        if (q.from) {
            where.push(`${prefix}"from" = ${ph()}`);
            params.push(q.from);
        }
        if (q.direction) {
            where.push(`${prefix}"direction" = ${ph()}`);
            params.push(q.direction);
        }
        if (q.type) {
            const types = Array.isArray(q.type) ? q.type : [q.type];
            const placeholders = types.map(() => ph()).join(',');
            where.push(`${prefix}"type" IN (${placeholders})`);
            params.push(...types);
        }
        if (q.dateFrom != null) {
            where.push(`${prefix}"timestamp" >= ${ph()}`);
            params.push(Math.ceil(q.dateFrom / 1000));
        }
        if (q.dateTo != null) {
            where.push(`${prefix}"timestamp" <= ${ph()}`);
            params.push(Math.floor(q.dateTo / 1000));
        }
    }
    async count(q, isPostgres) {
        const where = [];
        const params = [];
        if (isPostgres) {
            const ph = this.pgPlaceholder();
            const ftsTerm = `websearch_to_tsquery('simple', ${ph()}) AS q(query)`;
            params.push(q.q);
            where.push(`m.body_ts @@ q.query`);
            this.applyFilters(where, params, q, 'm.', ph);
            const sql = `SELECT count(*)::int AS n FROM messages m, ${ftsTerm} WHERE ${where.join(' AND ')}`;
            const rows = await this.dataSource.query(sql, params);
            return Number(rows[0]?.n ?? 0);
        }
        const ph = BuiltInFtsProvider_1.sqlitePlaceholder;
        where.push(`messages_fts MATCH ${ph()}`);
        params.push(BuiltInFtsProvider_1.toFts5Query(q.q));
        this.applyFilters(where, params, q, 'm.', ph);
        const sql = `SELECT count(*) AS n FROM messages_fts JOIN messages m ON m."rowid" = messages_fts."rowid" WHERE ${where.join(' AND ')}`;
        const rows = await this.dataSource.query(sql, params);
        return Number(rows[0]?.n ?? 0);
    }
};
exports.BuiltInFtsProvider = BuiltInFtsProvider;
exports.BuiltInFtsProvider = BuiltInFtsProvider = BuiltInFtsProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectDataSource)('data')),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], BuiltInFtsProvider);
//# sourceMappingURL=builtin-fts.provider.js.map