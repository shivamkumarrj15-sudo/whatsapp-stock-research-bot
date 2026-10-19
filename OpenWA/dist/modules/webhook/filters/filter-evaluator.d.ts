import { WebhookFilters } from './filter-types';
export type LidResolver = (jid: string) => string | null;
export declare function evaluateFilters(filters: WebhookFilters | null | undefined, event: string, data: Record<string, unknown>, resolve?: LidResolver): boolean;
