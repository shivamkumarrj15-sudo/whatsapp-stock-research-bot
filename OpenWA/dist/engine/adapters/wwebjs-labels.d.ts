import { Label, ChatSummary } from '../interfaces/whatsapp-engine.interface';
import { type WwebjsEngineHost } from './wwebjs-host';
export declare class WwebjsLabels {
    private readonly host;
    constructor(host: WwebjsEngineHost);
    private client;
    getLabels(): Promise<Label[]>;
    getChatsByLabel(labelId: string): Promise<ChatSummary[]>;
    getLabelById(labelId: string): Promise<Label | null>;
    getChatLabels(chatId: string): Promise<Label[]>;
    private readChatLabels;
    addLabelToChat(chatId: string, labelId: string): Promise<void>;
    removeLabelFromChat(chatId: string, labelId: string): Promise<void>;
    private changeChatLabel;
}
