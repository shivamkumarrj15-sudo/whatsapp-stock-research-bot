"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WwebjsChats = void 0;
exports.readChatModels = readChatModels;
exports.listChats = listChats;
const common_1 = require("@nestjs/common");
const wwebjs = __importStar(require("whatsapp-web.js"));
const whatsapp_web_js_1 = require("whatsapp-web.js");
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
const wa_id_1 = require("../identity/wa-id");
const wwebjs_lifecycle_1 = require("./wwebjs-lifecycle");
const message_mapper_1 = require("./message-mapper");
async function readChatModels() {
    const w = window;
    const chats = w.require('WAWebCollections').Chat.getModelsArray().slice();
    const pending = [];
    for (let i = 0; i < chats.length; i++) {
        const model = w.WWebJS.getChatModel(chats[i]);
        model.catch(() => undefined);
        pending.push(model);
        if ((i & 0xff) === 0xff)
            await new Promise(resolve => setTimeout(resolve));
    }
    return Promise.all(pending);
}
const { GroupChat, PrivateChat } = wwebjs;
async function listChats(host, context) {
    const client = host.getClient();
    const page = client.pupPage;
    let models;
    try {
        models = await page.evaluate(readChatModels);
    }
    catch (error) {
        if (host.isPageTransportError(error)) {
            host.reportIfPageTransportError(error, context);
            throw new engine_transport_error_1.EngineTransportError('Transport died while listing chats');
        }
        if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
            throw new engine_transport_error_1.EngineTransportError('WhatsApp Web did not answer the chat list read in time');
        }
        throw error;
    }
    return models.map(data => data.isGroup ? new GroupChat(client, data) : new PrivateChat(client, data));
}
class WwebjsChats {
    host;
    messaging;
    constructor(host, messaging) {
        this.host = host;
        this.messaging = messaging;
    }
    client() {
        return this.host.getClient();
    }
    async getChats() {
        this.host.ensureReady();
        const chats = await listChats(this.host, 'getChats');
        const summaries = [];
        let skipped = 0;
        for (const chat of chats) {
            const id = chat.id?._serialized;
            if (!id) {
                skipped++;
                continue;
            }
            summaries.push({
                id,
                name: chat.name || id,
                isGroup: Boolean(chat.isGroup),
                kind: (0, wa_id_1.chatKind)(id),
                unreadCount: chat.unreadCount || 0,
                timestamp: chat.timestamp || 0,
                lastMessage: chat.lastMessage?.type === whatsapp_web_js_1.MessageTypes.LOCATION ? '📍' : chat.lastMessage?.body || undefined,
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
        if (skipped > 0) {
            this.host.logger.warn(`Skipped ${skipped} chat(s) without a serialized id`);
        }
        return summaries;
    }
    async sendSeen(chatId) {
        this.host.ensureReady();
        try {
            const chat = await this.client().getChatById(chatId);
            return await chat.sendSeen();
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'sendSeen');
                throw new engine_transport_error_1.EngineTransportError('Transport died while marking a chat as read');
            }
            if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
                throw new engine_transport_error_1.EngineTransportError('WhatsApp Web did not answer in time while marking a chat as read');
            }
            this.host.logger.error(`Error marking chat ${chatId} as read`, String(error));
            return false;
        }
    }
    async clearChatMessages(chatId) {
        this.host.ensureReady();
        try {
            const chat = await this.client().getChatById(chatId);
            return await chat.clearMessages();
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'clearChatMessages');
                throw new engine_transport_error_1.EngineTransportError('Transport died while clearing a chat');
            }
            if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
                throw new engine_transport_error_1.EngineTransportError('WhatsApp Web did not answer in time while clearing a chat');
            }
            this.host.logger.error(`Error clearing messages in chat ${chatId}`, String(error));
            return false;
        }
    }
    async archiveChat(chatId, archive) {
        this.host.ensureReady();
        try {
            if (archive) {
                await this.client().archiveChat(chatId);
            }
            else {
                await this.client().unarchiveChat(chatId);
            }
            return true;
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'archiveChat');
                throw new engine_transport_error_1.EngineTransportError('Transport died while archiving a chat');
            }
            if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
                throw new engine_transport_error_1.EngineTransportError('WhatsApp Web did not answer in time while archiving a chat');
            }
            this.host.logger.error(`Error ${archive ? 'archiving' : 'unarchiving'} chat ${chatId}`, String(error));
            return false;
        }
    }
    async requireResolvableChat(chatId) {
        let chat;
        try {
            chat = await this.client().getChatById(chatId);
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'requireResolvableChat');
                throw new engine_transport_error_1.EngineTransportError('Transport died while resolving a chat');
            }
            if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
                throw new engine_transport_error_1.EngineTransportError('WhatsApp Web did not answer in time while resolving a chat');
            }
            chat = undefined;
        }
        if (!chat)
            throw new common_1.BadRequestException(`Chat ${chatId} does not exist on this session`);
    }
    async chatWrite(context, op) {
        try {
            return await op();
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, context);
                throw new engine_transport_error_1.EngineTransportError(`Transport died during ${context}`);
            }
            if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
                throw new engine_transport_error_1.EngineTransportError(`WhatsApp Web did not answer in time during ${context}`);
            }
            throw error;
        }
    }
    async muteChat(chatId, muteUntil) {
        this.host.ensureReady();
        await this.requireResolvableChat(chatId);
        if (muteUntil === null) {
            await this.chatWrite('muteChat', () => this.client().unmuteChat(chatId));
            return;
        }
        await this.chatWrite('muteChat', () => this.client().muteChat(chatId, new Date(muteUntil)));
    }
    async pinChat(chatId, pin) {
        this.host.ensureReady();
        await this.requireResolvableChat(chatId);
        if (!pin) {
            await this.chatWrite('pinChat', () => this.client().unpinChat(chatId));
            return true;
        }
        return await this.chatWrite('pinChat', () => this.client().pinChat(chatId));
    }
    async markUnread(chatId) {
        this.host.ensureReady();
        if ((0, wa_id_1.isChannelJid)(chatId)) {
            return false;
        }
        try {
            const chat = await this.client().getChatById(chatId);
            await chat.markUnread();
            return true;
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'markUnread');
                throw new engine_transport_error_1.EngineTransportError('Transport died while marking a chat as unread');
            }
            if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
                throw new engine_transport_error_1.EngineTransportError('WhatsApp Web did not answer in time while marking a chat as unread');
            }
            this.host.logger.error(`Error marking chat ${chatId} as unread`, String(error));
            return false;
        }
    }
    async deleteChat(chatId) {
        this.host.ensureReady();
        if ((0, wa_id_1.isChannelJid)(chatId)) {
            return false;
        }
        try {
            const chat = await this.client().getChatById(chatId);
            return await chat.delete();
        }
        catch (error) {
            if (this.host.isPageTransportError(error)) {
                this.host.reportIfPageTransportError(error, 'deleteChat');
                throw new engine_transport_error_1.EngineTransportError('Transport died while deleting a chat');
            }
            if ((0, wwebjs_lifecycle_1.isProtocolTimeout)(error)) {
                throw new engine_transport_error_1.EngineTransportError('WhatsApp Web did not answer in time while deleting a chat');
            }
            this.host.logger.error(`Error deleting chat ${chatId}`, String(error));
            return false;
        }
    }
    async setOnlinePresence(available) {
        this.host.ensureReady();
        await this.chatWrite('setOnlinePresence', () => available ? this.client().sendPresenceAvailable() : this.client().sendPresenceUnavailable());
    }
    async sendChatState(chatId, state) {
        this.host.ensureReady();
        if ((0, wa_id_1.isChannelJid)(chatId)) {
            return;
        }
        try {
            const to = await this.messaging.resolveSendId(chatId);
            const chat = await this.client().getChatById(to);
            if (state === 'typing') {
                await chat.sendStateTyping();
            }
            else if (state === 'recording') {
                await chat.sendStateRecording();
            }
            else {
                await chat.clearState();
            }
        }
        catch (error) {
            this.host.logger.warn(`Could not set chat state '${state}' for ${chatId} (best-effort)`, {
                error: String(error),
            });
        }
    }
}
exports.WwebjsChats = WwebjsChats;
//# sourceMappingURL=wwebjs-chats.js.map