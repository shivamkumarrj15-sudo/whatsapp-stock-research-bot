import { ConfigService } from '@nestjs/config';
import { PluginStatus, PluginStorage, PluginRegistryEntry } from './plugin.interfaces';
export declare class PluginStorageService {
    private readonly configService;
    private readonly logger;
    private readonly dataDir;
    private readonly registryPath;
    private readonly maxPluginStorageBytes;
    private registry;
    constructor(configService: ConfigService);
    private loadRegistry;
    private saveRegistry;
    getPluginEntry(pluginId: string): PluginRegistryEntry | undefined;
    setPluginEntry(entry: PluginRegistryEntry): void;
    deletePluginEntry(pluginId: string): void;
    getAllEntries(): PluginRegistryEntry[];
    getPluginStatus(pluginId: string): PluginStatus | null;
    setPluginStatus(pluginId: string, status: PluginStatus): void;
    setPluginEnabledByOperator(pluginId: string, enabled: boolean): void;
    getPluginConfig(pluginId: string): Record<string, unknown> | null;
    setPluginConfig(pluginId: string, config: Record<string, unknown>): void;
    getPluginSessions(pluginId: string): string[] | null;
    setPluginSessions(pluginId: string, sessions: string[]): void;
    getPluginSessionConfig(pluginId: string): Record<string, Record<string, unknown>> | null;
    setPluginSessionConfig(pluginId: string, sessionConfig: Record<string, Record<string, unknown>>): void;
    deletePluginData(pluginId: string): void;
    private assertStorageQuota;
    createPluginStorage(pluginId: string): PluginStorage;
}
