import { ClientBase } from 'pg';
import { DataSource } from 'typeorm';
export declare function parseTimestampAsUtc(value: string): unknown;
export declare const utcTimestampTypes: {
    getTypeParser(oid: number, format?: string): unknown;
};
declare const pinSessionToUtc: (client: ClientBase) => Promise<unknown>;
export declare function postgresUtcExtra(): {
    types: typeof utcTimestampTypes;
    onConnect: typeof pinSessionToUtc;
};
export declare function assertDataConnectionUtc(dataSource: DataSource): Promise<void>;
export {};
