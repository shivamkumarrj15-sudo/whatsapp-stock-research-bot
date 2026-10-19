import { OnModuleInit } from '@nestjs/common';
import Docker from 'dockerode';
export declare const MANAGED_DOCKER_PROFILES: readonly string[];
interface ContainerInfo {
    id: string;
    name: string;
    state: string;
    status: string;
    labels: Record<string, string>;
}
interface OrchestrationResult {
    success: boolean;
    message: string;
    containersStarted: string[];
    containersStopped: string[];
    errors: string[];
    estimatedTime: number;
}
export declare class DockerService implements OnModuleInit {
    private readonly logger;
    private docker;
    private isAvailable;
    private reinitInFlight;
    callTimeoutMs: number;
    private answered;
    private abortable;
    onModuleInit(): Promise<void>;
    private bootstrapOrchestration;
    startBuiltinDatabase(): Promise<void>;
    private initializeDocker;
    buildDockerOptions(): Docker.DockerOptions;
    isDockerAvailable(): boolean;
    listContainers(): Promise<ContainerInfo[]>;
    getRunningBuiltinServices(): Promise<{
        database: boolean;
        cache: boolean;
        storage: boolean;
    }>;
    getContainerByService(service: string): Promise<Docker.Container | null>;
    private getContainerSpec;
    createService(profile: string): Promise<boolean>;
    startService(service: string): Promise<boolean>;
    private warnOnImageDrift;
    stopManagedService(profile: string): Promise<boolean>;
    stopService(service: string): Promise<boolean>;
    orchestrateProfiles(profiles: string[]): Promise<OrchestrationResult>;
    getSystemInfo(): Promise<{
        available: boolean;
        info?: Record<string, unknown>;
    }>;
}
export declare function prestartBuiltinDatabase(env?: NodeJS.ProcessEnv, service?: Pick<DockerService, 'startBuiltinDatabase'>, timeoutMs?: number): Promise<void>;
export {};
