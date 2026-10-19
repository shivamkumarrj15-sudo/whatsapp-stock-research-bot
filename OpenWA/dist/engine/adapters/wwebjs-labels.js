"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WwebjsLabels = void 0;
const common_1 = require("@nestjs/common");
const message_mapper_1 = require("./message-mapper");
const wa_id_1 = require("../identity/wa-id");
const chat_labels_unsupported_error_1 = require("../../common/errors/chat-labels-unsupported.error");
const label_not_found_error_1 = require("../../common/errors/label-not-found.error");
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
const wwebjs_host_1 = require("./wwebjs-host");
const wwebjs_lifecycle_1 = require("./wwebjs-lifecycle");
class WwebjsLabels {
    host;
    constructor(host) {
        this.host = host;
    }
    client() {
        return this.host.getClient();
    }
    async getLabels() {
        this.host.ensureReady();
        const labels = await (0, wwebjs_host_1.withPage)(this.host, 'getLabels', () => this.client().getLabels());
        if (!labels) {
            return [];
        }
        return labels.map(label => ({
            id: String(label.id),
            name: String(label.name),
            hexColor: String(label.hexColor),
        }));
    }
    async getChatsByLabel(labelId) {
        this.host.ensureReady();
        let chats;
        try {
            chats = await this.client().getChatsByLabelId(labelId);
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'getChatsByLabel');
                throw new engine_transport_error_1.EngineTransportError(`Transport died while listing chats for label ${labelId}`);
            }
            if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
                throw new engine_transport_error_1.EngineTransportError(`WhatsApp Web did not answer the chat list for label ${labelId} in time`);
            }
            this.host.logger.debug('getChatsByLabelId rejected; treating the label as not found', {
                labelId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw new label_not_found_error_1.LabelNotFoundError(labelId);
        }
        const summaries = [];
        for (const chat of chats ?? []) {
            const id = chat?.id?._serialized;
            if (!id)
                continue;
            summaries.push({
                id,
                name: chat.name || id,
                isGroup: Boolean(chat.isGroup),
                kind: (0, wa_id_1.chatKind)(id),
                unreadCount: chat.unreadCount || 0,
                timestamp: chat.timestamp || 0,
                lastMessageType: chat.lastMessage ? (0, message_mapper_1.mapWwebjsMessageType)(chat.lastMessage.type) : undefined,
                archived: Boolean(chat.archived),
                pinned: Boolean(chat.pinned),
                muted: Boolean(chat.isMuted),
                muteExpiration: chat.isMuted
                    ? (chat.muteExpiration ?? 0) > 0
                        ? (chat.muteExpiration ?? 0) * 1000
                        : 0
                    : undefined,
            });
        }
        return summaries;
    }
    async getLabelById(labelId) {
        this.host.ensureReady();
        const labels = await (0, wwebjs_host_1.withPage)(this.host, 'getLabelById', () => this.client().getLabels());
        const label = labels?.find(candidate => String(candidate.id) === labelId);
        if (!label) {
            return null;
        }
        return {
            id: String(label.id),
            name: String(label.name),
            hexColor: String(label.hexColor),
        };
    }
    async getChatLabels(chatId) {
        this.host.ensureReady();
        if ((0, wa_id_1.isChannelJid)(chatId)) {
            return [];
        }
        return (await this.readChatLabels(chatId)) ?? [];
    }
    async readChatLabels(chatId) {
        const labels = await (0, wwebjs_host_1.withPage)(this.host, 'getChatLabels', async () => {
            const chat = await this.client().getChatById(chatId);
            return chat ? ((await chat.getLabels()) ?? []) : null;
        });
        if (!labels) {
            return null;
        }
        return labels.map(label => ({
            id: String(label.id),
            name: String(label.name),
            hexColor: String(label.hexColor),
        }));
    }
    async addLabelToChat(chatId, labelId) {
        this.host.ensureReady();
        await this.changeChatLabel(chatId, labelId, true);
    }
    async removeLabelFromChat(chatId, labelId) {
        this.host.ensureReady();
        await this.changeChatLabel(chatId, labelId, false);
    }
    async changeChatLabel(chatId, labelId, add) {
        if ((0, wa_id_1.isChannelJid)(chatId)) {
            throw new chat_labels_unsupported_error_1.ChatLabelsUnsupportedError('Channels do not support chat labels.');
        }
        const current = await this.readChatLabels(chatId);
        if (!current) {
            throw new common_1.NotFoundException(`Chat ${chatId} does not exist on this session`);
        }
        const ids = new Set(current.map(label => label.id));
        if (add) {
            ids.add(labelId);
        }
        else {
            ids.delete(labelId);
        }
        try {
            await (0, wwebjs_host_1.withPage)(this.host, 'changeChatLabel', () => this.client().addOrRemoveLabels([...ids], [chatId]));
        }
        catch (error) {
            if (String(error instanceof Error ? error.message : error).includes('LT01')) {
                throw new chat_labels_unsupported_error_1.ChatLabelsUnsupportedError();
            }
            throw error;
        }
        if (add && !(await this.getLabels()).some(label => label.id === labelId)) {
            throw new label_not_found_error_1.LabelNotFoundError(labelId);
        }
        this.host.logger.debug(add ? 'Added label to chat' : 'Removed label from chat', { labelId, chatId });
    }
}
exports.WwebjsLabels = WwebjsLabels;
//# sourceMappingURL=wwebjs-labels.js.map