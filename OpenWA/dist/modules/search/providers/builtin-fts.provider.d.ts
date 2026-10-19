import { OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { SearchProvider, SearchQuery, SearchResults } from '../search.types';
export declare class BuiltInFtsProvider implements SearchProvider, OnModuleInit {
    private readonly dataSource;
    readonly id = "builtin-fts";
    readonly label = "Built-in database full-text search";
    private readonly logger;
    constructor(dataSource: DataSource);
    onModuleInit(): Promise<void>;
    private ftsAvailable;
    private probeFts;
    private ensureFts;
    private ensureFtsSchema;
    search(query: SearchQuery): Promise<SearchResults>;
    health(): Promise<{
        ok: boolean;
        detail?: string;
    }>;
    private mapRow;
    private static sqlitePlaceholder;
    private pgPlaceholder;
    private static toFts5Query;
    private buildSqlite;
    private buildPostgres;
    private applyFilters;
    private count;
}
