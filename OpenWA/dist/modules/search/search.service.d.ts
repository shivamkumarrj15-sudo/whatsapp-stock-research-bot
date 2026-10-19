import { SearchProviderRegistry } from './search-provider.registry';
import type { SearchQuery, SearchResults } from './search.types';
export declare class SearchService {
    private readonly registry;
    constructor(registry: SearchProviderRegistry);
    search(query: SearchQuery, callerSessionIds?: string[], callerChatIds?: string[]): Promise<SearchResults>;
    health(): Promise<import("./search.types").SearchHealth>;
}
