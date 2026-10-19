"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POSTGRES_BOOT_MIGRATION_LOCK_KEYS = void 0;
exports.createBootDataSource = createBootDataSource;
const pg_1 = require("pg");
const typeorm_1 = require("typeorm");
const logger_service_1 = require("../common/services/logger.service");
const postgres_utc_1 = require("./postgres-utc");
const _1787200000000_DeduplicateTerminalWebhookFailures_1 = require("./migrations/1787200000000-DeduplicateTerminalWebhookFailures");
const logger = (0, logger_service_1.createLogger)('PgBootMigrations');
exports.POSTGRES_BOOT_MIGRATION_LOCK_KEYS = [0x4f5741, 0x626f6f74];
async function createBootDataSource(options, deps = {}) {
    const createDataSource = deps.createDataSource ?? (opts => new typeorm_1.DataSource(opts));
    const createLockClient = deps.createLockClient ?? createPgLockClient;
    if (options?.type === 'better-sqlite3' && options.synchronize) {
        const dataSource = createDataSource({ ...options, synchronize: false });
        try {
            await dataSource.initialize();
            const runner = dataSource.createQueryRunner();
            try {
                if (await runner.hasTable('webhook_delivery_failures')) {
                    await new _1787200000000_DeduplicateTerminalWebhookFailures_1.DeduplicateTerminalWebhookFailures1787200000000().up(runner);
                }
            }
            finally {
                await runner.release();
            }
            await dataSource.synchronize();
            return dataSource;
        }
        catch (error) {
            if (dataSource.isInitialized)
                await dataSource.destroy().catch(() => undefined);
            throw error;
        }
    }
    if (options?.type !== 'postgres') {
        return createDataSource(options);
    }
    const build = (extra) => createDataSource({ ...options, migrationsRun: false, extra: { ...extra, ...(0, postgres_utc_1.postgresUtcExtra)() } });
    const runtimeExtra = options.extra;
    const migrationExtra = { ...runtimeExtra };
    delete migrationExtra.statement_timeout;
    const migrator = build(migrationExtra);
    try {
        await migrator.initialize();
        await (0, postgres_utc_1.assertDataConnectionUtc)(migrator);
        let holding = false;
        let lockLost = false;
        const lockClient = createLockClient(lockClientConfig(options), () => {
            if (!holding)
                return;
            lockLost = true;
            void migrator.destroy().catch(() => undefined);
        });
        try {
            await lockClient.connect();
            await lockClient.query('SET idle_session_timeout = 0').catch(() => undefined);
            await lockClient.query('SELECT pg_advisory_lock($1, $2)', [...exports.POSTGRES_BOOT_MIGRATION_LOCK_KEYS]);
            holding = true;
            try {
                await migrator.runMigrations({ transaction: options.migrationsTransactionMode });
                if (lockLost)
                    throw new Error('Boot migration lock connection lost while migrating; retrying the boot');
            }
            finally {
                holding = false;
                await lockClient
                    .query('SELECT pg_advisory_unlock($1, $2)', [...exports.POSTGRES_BOOT_MIGRATION_LOCK_KEYS])
                    .catch(() => undefined);
            }
        }
        finally {
            await lockClient.end().catch(() => undefined);
        }
    }
    finally {
        await migrator.destroy().catch(() => undefined);
    }
    const dataSource = build(runtimeExtra);
    try {
        await dataSource.initialize();
        await (0, postgres_utc_1.assertDataConnectionUtc)(dataSource);
    }
    catch (error) {
        await dataSource.destroy().catch(() => undefined);
        throw error;
    }
    return dataSource;
}
function createPgLockClient(config, onLost) {
    const client = new pg_1.Client(config);
    client.on('error', (error) => {
        logger.warn(`Boot migration lock connection lost: ${error.message}`);
        onLost(error);
    });
    return client;
}
function lockClientConfig(options) {
    const extra = (options.extra ?? {});
    return {
        host: options.host,
        port: options.port,
        user: options.username,
        password: options.password,
        database: options.database,
        ssl: options.ssl,
        connectionTimeoutMillis: extra.connectionTimeoutMillis ?? 10000,
        options: '-c statement_timeout=0',
    };
}
//# sourceMappingURL=pg-boot-migrations.js.map