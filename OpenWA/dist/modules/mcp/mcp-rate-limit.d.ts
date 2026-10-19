export declare function readRateLimitConfig(env?: NodeJS.ProcessEnv): {
    max: number;
    windowMs: number;
};
export declare function readIpRateLimitConfig(env?: NodeJS.ProcessEnv): {
    max: number;
    windowMs: number;
};
export declare class KeyRateLimiter {
    private readonly max;
    private readonly windowMs;
    private readonly now;
    private readonly maxKeys;
    private readonly hits;
    constructor(max?: number, windowMs?: number, now?: () => number, maxKeys?: number);
    check(key: string): void;
}
