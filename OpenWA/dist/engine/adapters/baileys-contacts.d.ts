import type { WAMessage, WAMessageKey, WASocket } from '@whiskeysockets/baileys';
import { ChatSummary, Contact, MediaInput } from '../interfaces/whatsapp-engine.interface';
import { type createLogger } from '../../common/services/logger.service';
export interface BaileysContactsHost {
    sessionProxyUrl(): string | undefined;
    ensureReady(): void;
    getSocket(): WASocket;
    readonly logger: ReturnType<typeof createLogger>;
    normalizedSelfJid(): string;
    listContacts(): Contact[];
    findContact(contactId: string): Contact | null;
    resolvePhone(contactId: string): string | null;
    findPersistedLidPhone(lid: string): Promise<string | null>;
    recordLidMapping(lid: string, pn: string): void;
    listChats(): ChatSummary[];
    lastMessage(chatId: string): {
        key: WAMessageKey;
        timestamp: number;
        jid: string;
    } | null;
    lastInboundMessage(chatId: string): {
        key: WAMessageKey;
        timestamp: number;
    } | null;
    getStoredMessages(messageIds: string[]): Promise<WAMessage[]> | undefined;
    toEngineJid(jid: string): string;
    chatJid(chatId: string): string;
    toNeutralJid(jid: string): string;
}
export declare class BaileysContacts {
    private readonly host;
    private readonly queryBudgetMs;
    constructor(host: BaileysContactsHost, queryBudgetMs?: number);
    private confirmed;
    private sock;
    getProfilePicture(contactId: string): Promise<string | null>;
    upsertContact(contactId: string, firstName: string, lastName?: string): Promise<void>;
    deleteContact(contactId: string): Promise<void>;
    private mapUnresolvableId;
    blockContact(contactId: string): Promise<void>;
    unblockContact(contactId: string): Promise<void>;
    getBlockedContacts(budgetMs?: number): Promise<string[]>;
    setProfileName(name: string): Promise<void>;
    setProfileStatus(status: string): Promise<void>;
    setProfilePicture(media: MediaInput): Promise<void>;
    deleteProfilePicture(): Promise<void>;
    getContacts(): Promise<Contact[]>;
    getContactById(contactId: string): Promise<Contact | null>;
    private withBlockedState;
    private blocklistMemo?;
    private blocklistInFlight?;
    private blocklistGeneration;
    private static readonly BLOCKLIST_MEMO_MS;
    private static readonly BLOCKLIST_ENRICHMENT_BUDGET_MS;
    private blockedIds;
    private queryBlockedIds;
    private invalidateBlocklist;
    resolveContactPhone(contactId: string): Promise<string | null>;
    getChats(): Promise<ChatSummary[]>;
    sendSeen(chatId: string, messageIds?: string[]): Promise<boolean>;
    private receiptKeys;
    markUnread(chatId: string): Promise<boolean>;
    clearChatMessages(chatId: string): Promise<boolean>;
    archiveChat(chatId: string, archive: boolean): Promise<boolean>;
    muteChat(chatId: string, muteUntil: number | null): Promise<void>;
    pinChat(chatId: string, pin: boolean): Promise<boolean>;
    deleteChat(chatId: string): Promise<boolean>;
}
