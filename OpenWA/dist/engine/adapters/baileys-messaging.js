"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaileysMessaging = exports.MAX_STICKER_FRAMES = void 0;
exports.loadSharp = loadSharp;
exports.blockSvgDecoding = blockSvgDecoding;
exports.assertReadableImage = assertReadableImage;
exports.resolveMediaBuffer = resolveMediaBuffer;
const safe_link_preview_1 = require("./safe-link-preview");
const baileys_groups_1 = require("./baileys-groups");
const baileys_group_mapper_1 = require("./baileys-group-mapper");
const vcard_1 = require("./vcard");
const baileys_message_mapper_1 = require("./baileys-message-mapper");
const load_remote_media_1 = require("../../common/media/load-remote-media");
const common_1 = require("@nestjs/common");
const engine_not_ready_error_1 = require("../../common/errors/engine-not-ready.error");
const engine_refused_error_1 = require("../../common/errors/engine-refused.error");
const message_not_found_error_1 = require("../../common/errors/message-not-found.error");
const engine_transport_error_1 = require("../../common/errors/engine-transport.error");
const engine_not_sent_error_1 = require("../../common/errors/engine-not-sent.error");
const wa_id_1 = require("../identity/wa-id");
const baileys_query_deadline_1 = require("./baileys-query-deadline");
const concurrency_limiter_1 = require("../../common/utils/concurrency-limiter");
const baileys_audio_probe_1 = require("./baileys-audio-probe");
function isWebpBuffer(data) {
    return (data.length > 12 &&
        data.subarray(0, 4).toString('ascii') === 'RIFF' &&
        data.subarray(8, 12).toString('ascii') === 'WEBP');
}
async function loadSharp() {
    try {
        return (await import('sharp')).default;
    }
    catch (error) {
        throw new common_1.InternalServerErrorException(`Sticker conversion is unavailable: sharp could not load (${error instanceof Error ? error.message : String(error)}).`);
    }
}
async function blockSvgDecoding() {
    try {
        (await import('sharp')).default.block({ operation: ['VipsForeignLoadSvg'] });
    }
    catch {
    }
}
async function assertReadableImage(data) {
    const sharp = await import('sharp').then(module => module.default, () => undefined);
    if (!sharp)
        return;
    try {
        await sharp(data).metadata();
    }
    catch (error) {
        throw new common_1.BadRequestException(`The picture could not be read as an image (SVG is not accepted): ${error instanceof Error ? error.message : String(error)}`);
    }
}
exports.MAX_STICKER_FRAMES = 500;
const stickerConversions = new concurrency_limiter_1.ConcurrencyLimiter(2);
async function toWebpSticker(data, mimetype) {
    if (isWebpBuffer(data)) {
        return data;
    }
    if (!mimetype.startsWith('image/')) {
        throw new common_1.BadRequestException(`A sticker must be a WebP image, or an image this gateway can convert to one. Received '${mimetype}'.`);
    }
    const sharp = await loadSharp();
    try {
        const image = sharp(data, { animated: true });
        return await stickerConversions.run(async () => {
            const { pages = 1 } = await image.metadata();
            if (pages > exports.MAX_STICKER_FRAMES) {
                throw new common_1.BadRequestException(`The sticker animation has ${pages} frames; at most ${exports.MAX_STICKER_FRAMES} can be converted.`);
            }
            return image
                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp()
                .toBuffer();
        });
    }
    catch (error) {
        if (error instanceof common_1.BadRequestException)
            throw error;
        throw new common_1.BadRequestException(`The sticker image could not be converted to WebP: ${error instanceof Error ? error.message : String(error)}`);
    }
}
const GENERIC_FETCHED_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
async function resolveMediaBuffer(media, sessionProxyUrl, fallbackType) {
    if (Buffer.isBuffer(media.data)) {
        return { data: media.data, mimetype: media.mimetype };
    }
    if (/^https?:\/\//i.test(media.data)) {
        const fetched = await (0, load_remote_media_1.loadRemoteMediaBuffer)(media.data, sessionProxyUrl);
        const callerMimetype = media.mimetype && media.mimetype !== 'application/octet-stream' ? media.mimetype : null;
        const unknown = fallbackType !== undefined && GENERIC_FETCHED_TYPES.has(fetched.mimetype.toLowerCase());
        return { data: fetched.data, mimetype: callerMimetype ?? (unknown ? fallbackType : fetched.mimetype) };
    }
    return { data: Buffer.from(media.data, 'base64'), mimetype: media.mimetype };
}
class BaileysMessaging {
    host;
    queryBudgetMs;
    constructor(host, queryBudgetMs = baileys_query_deadline_1.BAILEYS_QUERY_BUDGET_MS) {
        this.host = host;
        this.queryBudgetMs = queryBudgetMs;
    }
    confirmed(work, operation) {
        return (0, baileys_query_deadline_1.withQueryDeadline)(work, this.queryBudgetMs, `WhatsApp did not confirm ${operation} in time`);
    }
    sock() {
        return this.host.getSocket();
    }
    async sendTextMessage(chatId, text, mentions, sendOptions) {
        this.host.ensureReady();
        const jid = await this.toDeliverableJid(chatId);
        const options = {
            ...(this.withEphemeral(jid) ?? {}),
            getUrlInfo: (text) => (0, safe_link_preview_1.generateSafeLinkPreview)(text, { sessionProxyUrl: this.host.sessionProxyUrl() }),
            ...((await this.quoteOption(sendOptions?.quotedMessageId)) ?? {}),
        };
        const content = {
            text,
            ...this.withMentions(mentions),
            ...(sendOptions?.linkPreview === true ? {} : { linkPreview: null }),
            ...(sendOptions?.customPreview
                ? {
                    linkPreview: {
                        'matched-text': sendOptions.customPreview.url,
                        'canonical-url': sendOptions.customPreview.url,
                        title: sendOptions.customPreview.title,
                        ...(sendOptions.customPreview.description ? { description: sendOptions.customPreview.description } : {}),
                    },
                }
                : {}),
        };
        const sent = await this.send(jid, content, options);
        if (sent) {
            void this.host.putStoredMessage(sent)?.catch(err => this.host.logger.warn('Failed to persist sent message to store', {
                error: err instanceof Error ? err.message : String(err),
            }));
            this.host.recordMessage(sent, 'text');
            void this.emitOwnSendEcho(sent);
        }
        return {
            id: sent?.key?.id ?? '',
            timestamp: this.host.toUnixSeconds(sent?.messageTimestamp),
        };
    }
    async checkNumberExists(number) {
        return (await this.getNumberId(number)) !== null;
    }
    async getNumberId(number) {
        this.host.ensureReady();
        const results = await (0, baileys_query_deadline_1.withQueryDeadline)(this.sock().onWhatsApp(number), this.queryBudgetMs, 'WhatsApp did not answer the number-check query in time');
        if (results === undefined) {
            throw new engine_transport_error_1.EngineTransportError('WhatsApp did not answer the number-check query');
        }
        const hit = results[0];
        return hit?.exists ? this.host.toNeutralJid(hit.jid) : null;
    }
    async sendChatState(chatId, state) {
        this.host.ensureReady();
        const presence = state === 'typing' ? 'composing' : state === 'recording' ? 'recording' : 'paused';
        try {
            await this.sock().sendPresenceUpdate(presence, await this.toDeliverableJid(chatId));
        }
        catch (error) {
            this.host.logger.warn(`Could not set chat state '${state}' for ${chatId} (best-effort)`, {
                error: String(error),
            });
        }
    }
    async setOnlinePresence(available) {
        this.host.ensureReady();
        if (!this.sock().user?.name) {
            throw new engine_not_ready_error_1.EngineNotReadyError('The account push name is not available yet, so this presence update would be ignored. Retry once the session has synced its profile name.');
        }
        await this.sock().sendPresenceUpdate(available ? 'available' : 'unavailable');
    }
    async subscribeToPresence(chatId) {
        this.host.ensureReady();
        await this.sock().presenceSubscribe(await this.toDeliverableJid(chatId));
    }
    async sendProductMessage(chatId, product, body) {
        this.host.ensureReady();
        if (!product.imageUrl) {
            throw new common_1.BadRequestException(`Product ${product.id} has no image — a product card requires one`);
        }
        const content = {
            product: {
                productId: product.id,
                title: product.name,
                description: product.description,
                currencyCode: product.currency,
                priceAmount1000: product.price === undefined ? undefined : Math.round(product.price * 1000),
                retailerId: product.retailerId,
                url: product.url || undefined,
                productImage: { url: product.imageUrl },
            },
            businessOwnerJid: this.host.toEngineJid(this.host.normalizedSelfJid()),
            body,
        };
        return this.sendContent(chatId, content);
    }
    async sendImageMessage(chatId, media) {
        this.host.ensureReady();
        const { data, mimetype } = await resolveMediaBuffer(media, this.host.sessionProxyUrl(), 'image/jpeg');
        return this.sendContent(chatId, {
            image: data,
            caption: media.caption,
            mimetype,
            ...this.withMentions(media.mentions),
        }, await this.quoteOption(media.quotedMessageId));
    }
    async sendVideoMessage(chatId, media) {
        this.host.ensureReady();
        const { data, mimetype } = await resolveMediaBuffer(media, this.host.sessionProxyUrl(), 'video/mp4');
        return this.sendContent(chatId, {
            video: data,
            caption: media.caption,
            mimetype,
            ...this.withMentions(media.mentions),
        }, await this.quoteOption(media.quotedMessageId));
    }
    async sendAudioMessage(chatId, media) {
        this.host.ensureReady();
        const { data, mimetype } = await resolveMediaBuffer(media, this.host.sessionProxyUrl(), 'audio/mpeg');
        const ptt = media.ptt ?? false;
        return this.sendContent(chatId, { audio: data, mimetype, ptt, ...(await (0, baileys_audio_probe_1.describeAudio)(data, ptt)), ...this.withMentions(media.mentions) }, await this.quoteOption(media.quotedMessageId));
    }
    async sendDocumentMessage(chatId, media) {
        this.host.ensureReady();
        const { data, mimetype } = await resolveMediaBuffer(media, this.host.sessionProxyUrl(), 'application/octet-stream');
        return this.sendContent(chatId, {
            document: data,
            mimetype,
            fileName: media.filename ?? 'file',
            caption: media.caption,
            ...this.withMentions(media.mentions),
        }, await this.quoteOption(media.quotedMessageId));
    }
    async createCallLink(type, startTime) {
        this.host.ensureReady();
        const lib = await this.host.loadLib();
        let token;
        try {
            token = await this.confirmed(this.sock().createCallLink(type, { startTime: Math.floor(startTime / 1000) }), 'the call link');
        }
        catch (err) {
            throw err instanceof engine_transport_error_1.EngineTransportError ? new Error(err.message) : err;
        }
        if (!token) {
            throw new engine_refused_error_1.EngineRefusedError('WhatsApp did not return a call link');
        }
        return `${type === 'video' ? lib.CALL_VIDEO_PREFIX : lib.CALL_AUDIO_PREFIX}${token}`;
    }
    async sendStickerMessage(chatId, media) {
        this.host.ensureReady();
        const { data, mimetype } = await resolveMediaBuffer(media, this.host.sessionProxyUrl());
        return this.sendContent(chatId, { sticker: await toWebpSticker(data, mimetype), ...this.withMentions(media.mentions) }, await this.quoteOption(media.quotedMessageId));
    }
    async sendLocationMessage(chatId, location) {
        this.host.ensureReady();
        return this.sendContent(chatId, {
            location: {
                degreesLatitude: location.latitude,
                degreesLongitude: location.longitude,
                name: location.description,
                address: location.address,
            },
        }, await this.quoteOption(location.quotedMessageId));
    }
    async sendContactMessage(chatId, contact) {
        this.host.ensureReady();
        return this.sendContent(chatId, {
            contacts: { displayName: contact.name, contacts: [{ vcard: (0, vcard_1.buildVCard)(contact) }] },
        }, await this.quoteOption(contact.quotedMessageId));
    }
    async sendPollMessage(chatId, poll) {
        this.host.ensureReady();
        return this.sendContent(chatId, {
            poll: {
                name: poll.name,
                values: poll.options,
                selectableCount: poll.allowMultipleAnswers ? 0 : 1,
            },
        }, await this.quoteOption(poll.quotedMessageId));
    }
    async replyToMessage(chatId, quotedMsgId, text, mentions) {
        this.host.ensureReady();
        const quoted = await this.requireStored(quotedMsgId);
        this.assertStoredInChat(quoted, chatId, quotedMsgId);
        return this.sendContent(chatId, { text, ...this.withMentions(mentions) }, { quoted });
    }
    async clickButton(chatId, messageId, buttonId, text) {
        this.host.ensureReady();
        const quoted = await this.requireStored(messageId);
        this.assertStoredInChat(quoted, chatId, messageId);
        const b = await this.host.loadLib();
        const normalized = b.normalizeMessageContent(quoted.message ?? undefined) ?? quoted.message ?? {};
        const contentType = b.getContentType(normalized);
        const resolved = (0, baileys_message_mapper_1.resolveBaileysButtonClick)(normalized, contentType, buttonId, text);
        if (!resolved.ok) {
            if (resolved.error === 'unknown_button') {
                throw new common_1.BadRequestException(`buttonId "${buttonId}" is not among the clickable choices on message ${messageId}`);
            }
            throw new common_1.BadRequestException(`message ${messageId} is not a WhatsApp Business button/list prompt that can be clicked`);
        }
        const result = await this.sendContent(chatId, resolved.payload.content, { quoted });
        return { ...result, body: resolved.payload.text };
    }
    async forwardMessage(fromChatId, toChatId, messageId) {
        this.host.ensureReady();
        const forward = await this.requireStored(messageId);
        this.assertStoredInChat(forward, fromChatId, messageId);
        return this.sendContent(toChatId, { forward });
    }
    async reactToMessage(chatId, messageId, emoji) {
        this.host.ensureReady();
        const target = await this.requireStored(messageId);
        this.assertStoredInChat(target, chatId, messageId);
        await this.send(await this.toDeliverableJid(chatId), { react: { text: emoji, key: target.key } });
    }
    async deleteMessage(chatId, messageId, forEveryone = true) {
        this.host.ensureReady();
        const target = await this.requireStored(messageId, true);
        this.assertStoredInChat(target, chatId, messageId);
        const chatJid = target.key.remoteJid ?? chatId;
        const previewJid = (0, baileys_message_mapper_1.baileysChatJid)(chatJid, target.key.participant, target.key.fromMe === true);
        if (forEveryone && (target.key.fromMe === true || (await this.selfIsGroupAdmin(target.key.remoteJid)) !== false)) {
            await this.send(await this.toDeliverableJid(chatId), { delete: target.key });
            this.host.recordMessageEdit(previewJid, messageId, '', 'revoked');
            this.host.markDeletedForEveryone(messageId);
            await this.changeStored(messageId, stored => ({ ...stored, message: null }));
            return;
        }
        await this.confirmed(this.sock().chatModify({
            deleteForMe: {
                deleteMedia: true,
                key: target.key,
                timestamp: this.host.toUnixSeconds(target.messageTimestamp),
            },
        }, this.host.toEngineJid(chatJid)), 'the delete-for-me');
        this.host.recordMessageEdit(previewJid, messageId, '', 'revoked');
    }
    async selfIsGroupAdmin(jid) {
        if (!jid?.endsWith('@g.us'))
            return false;
        const metadata = await (0, baileys_query_deadline_1.withQueryDeadline)(this.sock().groupMetadata(jid), this.queryBudgetMs, 'WhatsApp did not answer the group metadata query in time');
        const self = (0, baileys_group_mapper_1.findSelfParticipant)(metadata, this.host.normalizedSelfJid(), id => this.host.toNeutralJid(id));
        return self === undefined ? undefined : self.admin === 'admin' || self.admin === 'superadmin';
    }
    async editMessage(chatId, messageId, body, mentions) {
        this.host.ensureReady();
        const target = await this.requireStored(messageId);
        this.assertStoredInChat(target, chatId, messageId);
        if (target.key.fromMe !== true) {
            throw new engine_refused_error_1.EngineRefusedError(`the edit of message ${messageId} was rejected — only the account's own messages can be edited`);
        }
        const jid = await this.toDeliverableJid(chatId);
        const editContent = { text: body, ...this.withMentions(mentions), edit: target.key };
        const b = await this.host.loadLib();
        await this.send(jid, this.previewSafe(editContent), this.previewSafeOptions(editContent));
        this.host.recordMessageEdit(target.key.remoteJid ?? chatId, messageId, body);
        await this.changeStored(messageId, stored => {
            const content = b.normalizeMessageContent(stored.message ?? undefined);
            return content && (0, baileys_message_mapper_1.setBaileysText)(content, body) ? stored : null;
        });
        return { id: messageId, timestamp: this.host.toUnixSeconds(target.messageTimestamp) };
    }
    withMentions(mentions) {
        return mentions?.length ? { mentions: (0, baileys_groups_1.toEngineParticipants)(mentions, jid => this.host.toEngineJid(jid)) } : {};
    }
    async toDeliverableJid(chatId) {
        const { kind, userPart: user } = (0, wa_id_1.parseWaId)(chatId);
        if (kind === 'lid')
            return `${user}@lid`;
        if (kind !== 'user')
            return chatId;
        const pn = this.host.toEngineJid(chatId);
        const sock = this.sock();
        try {
            const lid = await (0, baileys_query_deadline_1.withQueryDeadline)(Promise.resolve(sock.signalRepository?.lidMapping?.getLIDForPN(pn)), this.queryBudgetMs, 'WhatsApp did not answer the recipient LID lookup in time');
            if (this.host.getSocketOrNull() !== sock)
                throw new engine_not_ready_error_1.EngineNotReadyError();
            if (lid)
                this.host.recordLidMapping(`${(0, wa_id_1.userPart)(lid)}@lid`, pn);
            return lid ? `${(0, wa_id_1.userPart)(lid)}@lid` : pn;
        }
        catch (error) {
            if (this.host.getSocketOrNull() !== sock || error instanceof engine_not_ready_error_1.EngineNotReadyError)
                throw new engine_not_ready_error_1.EngineNotReadyError();
            if (error instanceof engine_transport_error_1.EngineTransportError)
                throw new engine_not_sent_error_1.EngineNotSentError(error.message);
            return pn;
        }
    }
    withEphemeral(chatId, options) {
        const ephemeralExpiration = this.host.getEphemeralExpiration(chatId);
        if (ephemeralExpiration === undefined) {
            return options;
        }
        return { ...options, ephemeralExpiration };
    }
    previewSafe(content) {
        if (!('text' in content) || 'linkPreview' in content)
            return content;
        return { ...content, linkPreview: null };
    }
    previewSafeOptions(content, options) {
        if (!('text' in content))
            return options;
        return {
            ...(options ?? {}),
            getUrlInfo: (text) => (0, safe_link_preview_1.generateSafeLinkPreview)(text, { sessionProxyUrl: this.host.sessionProxyUrl() }),
        };
    }
    async sendContent(chatId, content, options) {
        const b = await this.host.loadLib();
        const jid = await this.toDeliverableJid(chatId);
        const safe = this.previewSafe(content);
        const merged = this.previewSafeOptions(safe, this.withEphemeral(jid, options));
        const sent = await this.send(jid, safe, merged);
        if (sent) {
            void this.host.putStoredMessage(sent)?.catch(err => this.host.logger.warn('Failed to persist sent message to store', {
                error: err instanceof Error ? err.message : String(err),
            }));
            let type;
            try {
                if (sent.message) {
                    const normalized = b.normalizeMessageContent(sent.message) ?? sent.message;
                    type = (0, baileys_message_mapper_1.mapBaileysMessageType)(b.getContentType(normalized), normalized.audioMessage?.ptt === true, (0, baileys_message_mapper_1.isBaileysCatalogShare)(normalized));
                }
            }
            catch (error) {
                this.host.logger.warn('Failed to classify sent message preview', { error: String(error) });
            }
            this.host.recordMessage(sent, type);
            void this.emitOwnSendEcho(sent);
        }
        return { id: sent?.key?.id ?? '', timestamp: this.host.toUnixSeconds(sent?.messageTimestamp) };
    }
    async send(jid, content, options) {
        const sock = this.sock();
        if ((0, wa_id_1.parseWaId)(jid).kind === 'user') {
            let numberId;
            try {
                numberId = await this.getNumberId(jid);
            }
            catch (error) {
                if (this.host.getSocketOrNull() !== sock)
                    throw new engine_not_ready_error_1.EngineNotReadyError();
                throw new engine_not_sent_error_1.EngineNotSentError(`WhatsApp could not check the recipient before send: ${String(error)}`);
            }
            if (this.host.getSocketOrNull() !== sock)
                throw new engine_not_ready_error_1.EngineNotReadyError();
            if (!numberId)
                throw new common_1.BadRequestException(`WhatsApp reports recipient ${jid} is not registered`);
            const canonical = this.host.toEngineJid(numberId);
            if (canonical !== jid)
                jid = await this.toDeliverableJid(numberId);
        }
        if (this.host.getSocketOrNull() !== sock)
            throw new engine_not_ready_error_1.EngineNotReadyError();
        let sent;
        try {
            sent = options ? await sock.sendMessage(jid, content, options) : await sock.sendMessage(jid, content);
        }
        catch (error) {
            if (this.host.getSocketOrNull() !== sock)
                throw new engine_not_ready_error_1.EngineNotReadyError();
            throw error;
        }
        if (!('react' in content || 'delete' in content || 'edit' in content))
            this.host.rememberOwnSend(sent?.key?.id);
        return sent;
    }
    async emitOwnSendEcho(sent) {
        const onMessageCreate = this.host.getOnMessageCreate();
        if (!onMessageCreate)
            return;
        try {
            const b = await this.host.loadLib();
            if (!sent.message || !sent.key?.remoteJid)
                return;
            const normalizedRoot = b.normalizeMessageContent(sent.message) ?? sent.message;
            const contentType = b.getContentType(normalizedRoot);
            if (!contentType || contentType === 'protocolMessage' || contentType === 'reactionMessage')
                return;
            const neutral = await this.host.mapMessage(sent, contentType, { skipMediaDownload: true });
            onMessageCreate(neutral);
        }
        catch (err) {
            this.host.logger.warn('Failed to emit own-send echo', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    async quoteOption(quotedMessageId) {
        if (!quotedMessageId)
            return undefined;
        return { quoted: await this.requireStored(quotedMessageId) };
    }
    async requireStored(messageId, allowDeleted = false) {
        const found = await this.host.getStoredMessage(messageId);
        const deleted = !found?.message || this.host.wasDeletedForEveryone(messageId);
        if (!found?.key || (deleted && !allowDeleted)) {
            throw new message_not_found_error_1.MessageNotFoundError(messageId);
        }
        const edited = deleted ? undefined : this.host.pendingEditOf(messageId, found.key);
        if (edited === undefined)
            return found;
        const b = await this.host.loadLib();
        const copy = JSON.parse(JSON.stringify(found, b.BufferJSON.replacer), b.BufferJSON.reviver);
        const content = b.normalizeMessageContent(copy.message ?? undefined);
        if (content)
            (0, baileys_message_mapper_1.setBaileysText)(content, edited);
        return copy;
    }
    async changeStored(messageId, change) {
        try {
            await this.host.updateStoredMessage(messageId, change);
        }
        catch (err) {
            this.host.logger.warn('Failed to apply an edit or delete to the message store', {
                msgId: messageId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    assertStoredInChat(target, chatId, messageId) {
        if (!(0, baileys_message_mapper_1.storedKeyInChat)(target.key, chatId, jid => this.host.toNeutralJid(jid))) {
            throw new message_not_found_error_1.MessageNotFoundError(messageId, chatId);
        }
    }
    async starMessage(chatId, messageId, star) {
        this.host.ensureReady();
        const target = await this.requireStored(messageId);
        this.assertStoredInChat(target, chatId, messageId);
        await this.confirmed(this.sock().chatModify({ star: { messages: [{ id: target.key.id, fromMe: target.key.fromMe ?? false }], star } }, this.host.toEngineJid(target.key.remoteJid ?? chatId)), 'the star change');
    }
    async pinMessage(chatId, messageId, durationSeconds) {
        this.host.ensureReady();
        const target = await this.requireStored(messageId);
        this.assertStoredInChat(target, chatId, messageId);
        const { proto } = await this.host.loadLib();
        await this.send(await this.toDeliverableJid(chatId), {
            pin: target.key,
            type: proto.PinInChat.Type.PIN_FOR_ALL,
            time: durationSeconds,
        });
    }
    async unpinMessage(chatId, messageId) {
        this.host.ensureReady();
        const target = await this.requireStored(messageId);
        this.assertStoredInChat(target, chatId, messageId);
        const { proto } = await this.host.loadLib();
        await this.send(await this.toDeliverableJid(chatId), {
            pin: target.key,
            type: proto.PinInChat.Type.UNPIN_FOR_ALL,
        });
    }
}
exports.BaileysMessaging = BaileysMessaging;
//# sourceMappingURL=baileys-messaging.js.map