type EnvConfig = Record<string, unknown>;
export declare function sqliteDataMainPathCollision(config: EnvConfig): string | null;
export declare function postgresSchemaError(schema: string): string | null;
export declare function validateEnv(config: EnvConfig): EnvConfig;
export {};
