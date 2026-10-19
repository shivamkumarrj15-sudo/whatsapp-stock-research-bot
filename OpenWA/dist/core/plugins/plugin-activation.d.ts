export declare function isPluginActiveForSession(sessionScoped: boolean, activeSessions: string[], sessionId: string | undefined): boolean;
export declare function resolveInstanceConfig(resolved: Record<string, unknown>, instanceConfig: Record<string, unknown> | null | undefined): Record<string, unknown>;
export declare function resolvePluginConfig(base: Record<string, unknown>, sessionConfig: Record<string, Record<string, unknown>> | undefined, sessionId: string | undefined, sessionScoped: boolean): Record<string, unknown>;
