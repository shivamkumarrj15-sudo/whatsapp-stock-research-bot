"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaileysEvents = void 0;
exports.differentWaIds = differentWaIds;
exports.isWhatsAppMediaSource = isWhatsAppMediaSource;
const baileys_message_mapper_1 = require("./baileys-message-mapper");
const message_mapper_1 = require("./message-mapper");
const baileys_history_1 = require("./baileys-history");
const baileys_secret_payload_1 = require("./baileys-secret-payload");
const engine_not_ready_error_1 = require("../../common/errors/engine-not-ready.error");
const call_not_found_error_1 = require("../../common/errors/call-not-found.error");
const inbound_media_cap_1 = require("./inbound-media-cap");
const baileys_logger_1 = require("./baileys-logger");
const baileys_query_deadline_1 = require("./baileys-query-deadline");
const wa_id_1 = require("../identity/wa-id");
const CALL_OUTCOMES = {
    accept: 'accepted',
    reject: 'rejected',
    timeout: 'missed',
};
const PRESENCE_STATES = new Set([
    'available',
    'unavailable',
    'composing',
    'recording',
    'paused',
]);
const PROTOCOL_NOISE_KEYS = new Set([
    'senderKeyDistributionMessage',
    'fastRatchetKeySenderKeyDistributionMessage',
    'messageContextInfo',
    'messageHistoryNotice',
    'messageHistoryBundle',
]);
function differentWaIds(a, b, toNeutralJid) {
    const x = a.filter((j) => !!j).map(toNeutralJid);
    const y = b.filter((j) => !!j).map(toNeutralJid);
    if (!x.length || !y.length || x.some(j => y.includes(j)))
        return false;
    const lidGap = (p, q) => p.some(j => j.endsWith('@lid')) && !q.some(j => j.endsWith('@lid')) && q.some(j => j.endsWith('@c.us'));
    return !lidGap(x, y) && !lidGap(y, x);
}
function isWhatsAppMediaSource(b, message) {
    const content = b.extractMessageContent(message);
    const type = content ? b.getContentType(content) : undefined;
    const media = type ? content?.[type] : undefined;
    if (!media || typeof media !== 'object')
        return true;
    const node = media;
    const thumbnailOnly = 'thumbnailDirectPath' in media && !('url' in media);
    const url = thumbnailOnly ? undefined : node.url;
    const directPath = thumbnailOnly ? node.thumbnailDirectPath : node.directPath;
    let host = 'mmg.whatsapp.net';
    try {
        if (url)
            host = new URL(url).host;
    }
    catch {
    }
    const target = directPath ? `https://${host}${directPath}` : url;
    if (!target)
        return true;
    try {
        const parsed = new URL(target);
        return (parsed.protocol === 'https:' &&
            parsed.port === '' &&
            (parsed.hostname === 'whatsapp.net' || parsed.hostname.endsWith('.whatsapp.net')));
    }
    catch {
        return false;
    }
}
const BAILEYS_MEDIA_TYPES = new Set([
    'imageMessage',
    'videoMessage',
    'ptvMessage',
    'audioMessage',
    'documentMessage',
    'documentWithCaptionMessage',
    'stickerMessage',
]);
function isBaileysMediaType(contentType) {
    return contentType !== undefined && BAILEYS_MEDIA_TYPES.has(contentType);
}
function mediaSubMessage(normalized) {
    return (normalized.imageMessage ??
        normalized.videoMessage ??
        normalized.ptvMessage ??
        normalized.audioMessage ??
        normalized.documentMessage ??
        normalized.stickerMessage);
}
class LiveCallMap extends Map {
    clears = 0;
    clear() {
        this.clears++;
        super.clear();
    }
}
class BaileysEvents {
    host;
    static LIVE_CALL_TTL_MS = 2 * 60_000;
    liveCalls = new LiveCallMap();
    static DELETED_FOR_EVERYONE_LIMIT = 5_000;
    inboundInFlight = new Map();
    deletedForEveryone = new Set();
    editedWhileInFlight = new Map();
    outcomesPending = new Map();
    changesParked = 0;
    static CHANGES_PARKED_LIMIT = 64;
    copyRemovals = new Map();
    static OUTCOME_HOLD_MS = 5 * 60_000;
    storeGeneration = 0;
    constructor(host) {
        this.host = host;
    }
    fenceStoredWrites() {
        this.storeGeneration++;
    }
    wasDeletedForEveryone(messageId) {
        return this.deletedForEveryone.has(messageId);
    }
    pendingEditOf(messageId, target) {
        const edit = this.inboundInFlight.has(messageId) ? this.editedWhileInFlight.get(messageId) : undefined;
        return edit && this.mayChange(target, edit.envelope, false) ? edit.body : undefined;
    }
    markDeletedForEveryone(messageId) {
        this.deletedForEveryone.add(messageId);
        if (this.deletedForEveryone.size > BaileysEvents.DELETED_FOR_EVERYONE_LIMIT) {
            const [oldest] = this.deletedForEveryone;
            this.deletedForEveryone.delete(oldest);
        }
    }
    async applyHistoryRevoke(target, envelope) {
        if (!target.id)
            return undefined;
        const generation = this.storeGeneration;
        const found = await this.readTarget(target.id, 'checking what a history revoke targets');
        if (generation !== this.storeGeneration)
            return undefined;
        const original = found?.key ?? target;
        if (!this.mayChange(original, envelope, true))
            return undefined;
        if (found)
            this.markDeletedForEveryone(target.id);
        this.changeStoredMessage(target.id, copy => this.mayChange(copy.key, envelope, true) ? { ...copy, message: null } : null);
        return original;
    }
    handleMessagesUpsert(event) {
        for (const msg of event.messages) {
            if (!msg.message || !msg.key?.remoteJid) {
                continue;
            }
            if (msg.key.fromMe === true && this.host.consumeOwnSend(msg.key.id)) {
                this.host.logger.debug('Skipping the echo of a message this session sent', {
                    msgId: msg.key.id ?? 'unknown',
                    type: event.type,
                });
                continue;
            }
            const firstKey = msg.key.id ? this.inboundInFlight.get(msg.key.id)?.key : undefined;
            if (firstKey && this.namesAnotherMessage(firstKey, msg.key)) {
                this.host.logger.warn('Dropping a message that reuses the id of one still being processed', {
                    msgId: msg.key.id ?? 'unknown',
                    remoteJid: msg.key.remoteJid,
                });
                continue;
            }
            const generation = this.storeGeneration;
            const ticket = this.admitInbound(msg);
            const processed = this.host.inboundLimiter
                .run(yieldSlot => this.processInboundMessage(msg, { generation, ticket, yieldSlot }))
                .catch((error) => {
                const closed = error instanceof Error && error.message.startsWith('ConcurrencyLimiter closed');
                this.host.logger.warn(closed
                    ? 'Inbound media limiter closed during teardown; emitting message without media'
                    : 'Inbound media download failed; emitting message without media', { msgId: msg.key?.id ?? 'unknown', ...(closed ? {} : { error: String(error) }) });
                return this.processInboundMessage(msg, { generation, skipMedia: true, ticket });
            });
            ticket?.holdUntil(processed);
            void processed.finally(() => ticket?.drop());
            const id = msg.key.id;
            if (id) {
                const tracked = {
                    key: msg.key,
                    message: msg.message,
                    done: Promise.all([this.inboundInFlight.get(id)?.done, processed]).then(() => undefined),
                };
                this.inboundInFlight.set(id, tracked);
                void tracked.done.finally(() => {
                    if (this.inboundInFlight.get(id) !== tracked)
                        return;
                    this.inboundInFlight.delete(id);
                    this.editedWhileInFlight.delete(id);
                });
            }
        }
    }
    namesAnotherMessage(first, key) {
        const neutral = (jid) => this.host.toNeutralJid(jid);
        return ((first.fromMe === true) !== (key.fromMe === true) ||
            differentWaIds([first.remoteJid, first.remoteJidAlt], [key.remoteJid, key.remoteJidAlt], neutral) ||
            (key.fromMe !== true &&
                differentWaIds([first.participant, first.participantAlt], [key.participant, key.participantAlt], neutral)));
    }
    admitInbound(msg) {
        const admit = this.host.getAdmitInbound?.();
        if (!admit)
            return undefined;
        return (0, inbound_media_cap_1.admitInboundSafely)(() => {
            this.host.recordKeyLidMappings(msg.key);
            const remoteJid = msg.key.remoteJid;
            const behindChat = (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) && msg.key.participant;
            return admit({
                id: msg.key.id ?? '',
                chatId: this.host.toNeutralJid((0, baileys_message_mapper_1.baileysChatJid)(remoteJid, msg.key.participant, msg.key.fromMe === true)),
                status: remoteJid === 'status@broadcast',
                needsRoom: this.plannedMediaDownload(this.host.getLoadedLib?.(), msg),
                fromMe: msg.key.fromMe === true,
                ...(behindChat ? { author: this.host.toNeutralJid(msg.key.participant) } : {}),
            });
        }, error => this.host.logger.error(`Could not admit inbound message ${msg.key.id ?? 'unknown'}; processing it without room for media`, String(error)));
    }
    plannedMediaDownload(b, msg) {
        if (!b)
            return true;
        const ownStatusPost = msg.key.fromMe === true && msg.key.remoteJid === 'status@broadcast';
        const normalized = b.normalizeMessageContent(msg.message ?? undefined) ?? msg.message ?? undefined;
        return (isBaileysMediaType(b.getContentType(normalized)) &&
            !ownStatusPost &&
            (0, inbound_media_cap_1.isMediaDownloadEnabled)() &&
            (0, inbound_media_cap_1.coerceDeclaredSize)(mediaSubMessage(normalized ?? {})?.fileLength) <= (0, inbound_media_cap_1.inboundMediaMaxBytes)());
    }
    logContactEvent(event, records = []) {
        const list = records ?? [];
        this.host.logger.debug('Baileys contacts event', {
            action: 'baileys_contacts',
            event,
            count: list.length,
            withName: list.filter(r => r.name || r.notify || r.verifiedName).length,
            withLid: list.filter(r => r.lid).length,
            sample: list.slice(0, 3).map(r => ({ id: r.id, name: r.name, notify: r.notify, lid: r.lid, jid: r.jid })),
        });
    }
    async processInboundMessage(msg, opts) {
        try {
            const b = await this.host.loadLib();
            const remoteJid = msg.key.remoteJid;
            const chatJid = (0, baileys_message_mapper_1.baileysChatJid)(remoteJid, msg.key.participant, msg.key.fromMe === true);
            if (!opts.ticket)
                this.host.recordKeyLidMappings(msg.key);
            let normalizedRoot = b.normalizeMessageContent(msg.message ?? undefined) ?? msg.message ?? undefined;
            let contentType = b.getContentType(normalizedRoot);
            if (contentType === 'secretEncryptedMessage' || contentType === 'encReactionMessage') {
                const revealed = await this.revealEncryptedModification(b, msg, normalizedRoot, contentType);
                if (revealed) {
                    normalizedRoot = revealed.content;
                    contentType = revealed.contentType;
                }
            }
            if (contentType === 'protocolMessage') {
                const pm = normalizedRoot?.protocolMessage;
                if (pm?.type === b.proto.Message.ProtocolMessage.Type.REVOKE) {
                    if (await this.targetsForeignMessage(pm.key?.id, msg.key, !remoteJid.endsWith('@g.us'), undefined, opts)) {
                        return;
                    }
                    const from = msg.key.fromMe === true ? this.host.normalizedSelfJid() : chatJid;
                    const to = msg.key.fromMe === true ? chatJid : this.host.normalizedSelfJid();
                    const revoked = {
                        id: pm.key?.id ?? '',
                        revokedId: pm.key?.id ?? undefined,
                        chatId: this.host.toNeutralJid(chatJid),
                        from: this.host.toNeutralJid(from),
                        to: this.host.toNeutralJid(to),
                        type: 'revoked',
                        body: '',
                        timestamp: (0, baileys_history_1.toUnixSeconds)(msg.messageTimestamp),
                    };
                    this.host.recordMessageEdit(chatJid, revoked.id, '', 'revoked');
                    const target = this.inboundInFlight.get(revoked.id);
                    if (target && this.mayChange(target.key, msg.key, true)) {
                        this.markDeletedForEveryone(revoked.id);
                    }
                    this.changeStoredMessage(pm.key?.id, stored => this.mayChange(stored.key, msg.key, true) ? { ...stored, message: null } : null);
                    this.host.getOnMessageRevoked()?.(revoked, { fromMe: msg.key.fromMe === true });
                    return;
                }
                if (pm?.type === b.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT) {
                    if (await this.targetsForeignMessage(pm.key?.id, msg.key, true, undefined, opts))
                        return;
                    const normalizedEdited = b.normalizeMessageContent(pm.editedMessage ?? undefined) ?? pm.editedMessage ?? {};
                    const editedContentType = b.getContentType(normalizedEdited);
                    const editedSubMessage = normalizedEdited.extendedTextMessage ??
                        normalizedEdited.imageMessage ??
                        normalizedEdited.videoMessage ??
                        normalizedEdited.audioMessage ??
                        normalizedEdited.documentMessage ??
                        normalizedEdited.stickerMessage ??
                        normalizedEdited.locationMessage;
                    const contextInfo = editedSubMessage?.contextInfo;
                    const base = (0, baileys_message_mapper_1.buildIncomingMessageFromBaileys)({
                        id: pm.key?.id ?? '',
                        remoteJid,
                        fromMe: msg.key.fromMe === true,
                        participant: (0, baileys_message_mapper_1.keyParticipant)(msg.key),
                        body: (0, baileys_message_mapper_1.extractBaileysBody)(normalizedEdited),
                        contentType: editedContentType,
                        isPtt: normalizedEdited.audioMessage?.ptt === true,
                        timestamp: this.toEditUnixSeconds(pm.timestampMs, msg.messageTimestamp),
                        selfJid: this.host.normalizedSelfJid(),
                        mentionedJids: contextInfo?.mentionedJid ?? undefined,
                    }, jid => this.host.toNeutralJid(jid));
                    const hasMedia = editedContentType === 'imageMessage' ||
                        editedContentType === 'videoMessage' ||
                        editedContentType === 'audioMessage' ||
                        editedContentType === 'documentMessage' ||
                        editedContentType === 'documentWithCaptionMessage' ||
                        editedContentType === 'stickerMessage';
                    const edited = (0, message_mapper_1.buildEditedMessage)(base, hasMedia);
                    this.host.recordMessageEdit(chatJid, edited.messageId, edited.body);
                    const target = this.inboundInFlight.get(edited.messageId);
                    if (target && this.mayChange(target.key, msg.key, false)) {
                        this.editedWhileInFlight.delete(edited.messageId);
                        this.editedWhileInFlight.set(edited.messageId, { envelope: msg.key, body: edited.body });
                        if (this.editedWhileInFlight.size > BaileysEvents.DELETED_FOR_EVERYONE_LIMIT) {
                            const [oldest] = this.editedWhileInFlight.keys();
                            this.editedWhileInFlight.delete(oldest);
                        }
                    }
                    this.changeStoredMessage(edited.messageId, stored => {
                        const content = this.mayChange(stored.key, msg.key, false)
                            ? b.normalizeMessageContent(stored.message ?? undefined)
                            : undefined;
                        return content && (0, baileys_message_mapper_1.setBaileysText)(content, edited.body) ? stored : null;
                    });
                    this.host.getOnMessageEdited()?.(edited);
                    return;
                }
                return;
            }
            if (contentType === 'reactionMessage') {
                const rm = normalizedRoot?.reactionMessage;
                if (await this.targetsForeignMessage(rm?.key?.id, msg.key, false, 'reaction', opts))
                    return;
                const event = {
                    messageId: rm?.key?.id ?? '',
                    chatId: this.host.toNeutralJid(chatJid),
                    reaction: rm?.text ?? '',
                    senderId: this.host.toNeutralJid((0, baileys_message_mapper_1.keyParticipant)(msg.key) ?? (msg.key.fromMe === true ? this.host.normalizedSelfJid() : remoteJid)),
                };
                this.host.getOnMessageReaction()?.(event);
                return;
            }
            if (contentType && baileys_message_mapper_1.BAILEYS_NON_CONTENT_TYPES.has(contentType)) {
                this.host.logger.debug('Dropping a message that carries no content of its own', {
                    action: 'baileys_drop_non_content',
                    msgId: msg.key.id,
                    remoteJid,
                    contentType,
                });
                return;
            }
            const keys = Object.keys(normalizedRoot ?? {});
            if (keys.every(k => PROTOCOL_NOISE_KEYS.has(k)) && keys.some(k => k !== 'messageContextInfo')) {
                this.host.logger.debug('Dropping contentless protocol message', {
                    action: 'baileys_drop_protocol_noise',
                    msgId: msg.key.id,
                    remoteJid,
                    keys,
                });
                return;
            }
            const storedId = msg.key.id ?? null;
            if (storedId !== null && (await this.readStoredMessage(storedId, 'checking for a repeat delivery'))) {
                this.host.logger.debug('Skipping a re-delivered message this session already recorded', {
                    msgId: storedId,
                });
                return;
            }
            const ownStatusPost = msg.key.fromMe === true && remoteJid === 'status@broadcast';
            const incoming = await this.mapMessage(msg, contentType, {
                skipMediaDownload: opts.skipMedia || ownStatusPost,
                ticket: opts.ticket,
                yieldSlot: opts.yieldSlot,
            });
            const deleted = storedId !== null && this.deletedForEveryone.has(storedId);
            const edit = storedId !== null && !deleted ? this.editedWhileInFlight.get(storedId) : undefined;
            const editedBody = edit && this.mayChange(msg.key, edit.envelope, false) ? edit.body : undefined;
            let toStore = deleted ? { ...msg, message: null } : msg;
            if (editedBody !== undefined) {
                toStore = JSON.parse(JSON.stringify(msg, b.BufferJSON.replacer), b.BufferJSON.reviver);
                const content = b.normalizeMessageContent(toStore.message ?? undefined);
                if (content)
                    (0, baileys_message_mapper_1.setBaileysText)(content, editedBody);
                incoming.body = editedBody;
            }
            if (opts.generation === this.storeGeneration) {
                void this.host.putStoredMessage(toStore)?.catch(err => this.host.logger.warn('Failed to persist message to store', {
                    error: err instanceof Error ? err.message : String(err),
                }));
            }
            if (!deleted || opts.ticket?.revoked) {
                const emit = msg.key.fromMe === true ? this.host.getOnMessageCreate() : this.host.getOnMessage();
                const receipt = opts.ticket ? emit?.(incoming, opts.ticket) : emit?.(incoming);
                this.watchOutcome(msg.key, receipt);
            }
            this.host.recordMessage(msg, incoming.type);
            if (deleted) {
                this.host.recordMessageEdit(chatJid, storedId, '', 'revoked');
            }
            else if (editedBody !== undefined && storedId !== null) {
                this.host.recordMessageEdit(chatJid, storedId, editedBody);
            }
        }
        catch (err) {
            this.host.logger.error(`Unhandled error processing inbound message (id=${msg.key?.id ?? 'unknown'}); dropping`, err instanceof Error ? err.message : String(err));
        }
    }
    watchOutcome(key, receipt) {
        const id = key.id;
        if (!id || !receipt?.settled)
            return;
        const release = key.remoteJid === 'status@broadcast' ? undefined : this.holdOutcome(id);
        void Promise.resolve(receipt.settled)
            .then(result => (result?.conflict === true ? this.dropConflictingCopy(key, id) : undefined))
            .catch((err) => this.host.logger.warn('Could not act on what the session made of a message', {
            msgId: id,
            error: err instanceof Error ? err.message : String(err),
        }))
            .finally(() => release?.());
    }
    holdOutcome(id) {
        let hold = this.outcomesPending.get(id);
        if (!hold) {
            let free;
            const ended = new Promise(resolve => (free = resolve));
            hold = { count: 0, ended, free };
            this.outcomesPending.set(id, hold);
        }
        const entry = hold;
        entry.count++;
        let ended = false;
        const end = () => {
            if (ended)
                return;
            ended = true;
            clearTimeout(timer);
            if (--entry.count > 0)
                return;
            this.outcomesPending.delete(id);
            entry.free();
        };
        const timer = setTimeout(end, BaileysEvents.OUTCOME_HOLD_MS);
        timer.unref();
        return end;
    }
    async dropConflictingCopy(key, id) {
        this.host.logger.warn('Dropping the stored copy of a message that reuses the id of another message', {
            msgId: id,
            remoteJid: key.remoteJid,
        });
        try {
            await this.host.removeStoredMessage(id, stored => stored.key?.remoteJid === key.remoteJid &&
                (0, baileys_message_mapper_1.keyParticipant)(stored.key ?? {}) === (0, baileys_message_mapper_1.keyParticipant)(key) &&
                (stored.key?.fromMe === true) === (key.fromMe === true));
        }
        catch (err) {
            this.host.logger.warn('Failed to remove the stored copy of a conflicting message', {
                msgId: id,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        const removed = this.removalsOf(id) + 1;
        this.copyRemovals.delete(id);
        this.copyRemovals.set(id, removed);
        if (this.copyRemovals.size > BaileysEvents.DELETED_FOR_EVERYONE_LIMIT) {
            const [oldest] = this.copyRemovals.keys();
            this.copyRemovals.delete(oldest);
        }
    }
    removalsOf(id) {
        return this.copyRemovals.get(id) ?? 0;
    }
    async readTarget(messageId, purpose) {
        const processing = this.inboundInFlight.get(messageId);
        const stored = await this.readStoredMessage(messageId, purpose);
        if (stored)
            return { key: stored.key, message: stored.message };
        const inFlight = processing ?? this.inboundInFlight.get(messageId);
        return inFlight ? { key: inFlight.key, message: inFlight.message, processing: inFlight.done } : null;
    }
    async readStoredMessage(messageId, purpose) {
        try {
            return (await this.host.getStoredMessage(messageId)) ?? null;
        }
        catch (err) {
            this.host.logger.warn(`Could not read the message store while ${purpose}`, {
                msgId: messageId,
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }
    async revealEncryptedModification(b, msg, content, contentType) {
        try {
            const isEdit = contentType === 'secretEncryptedMessage';
            const encrypted = isEdit ? content?.secretEncryptedMessage : content?.encReactionMessage;
            const targetKey = encrypted?.targetMessageKey;
            const targetId = targetKey?.id;
            const payload = (0, baileys_secret_payload_1.bytesOf)(encrypted?.encPayload);
            const iv = (0, baileys_secret_payload_1.bytesOf)(encrypted?.encIv);
            if (!encrypted || !targetKey || !targetId || !payload || !iv)
                return undefined;
            if (isEdit) {
                const type = encrypted.secretEncType;
                const editType = b.proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT;
                if (type !== editType && type !== 'MESSAGE_EDIT')
                    return undefined;
            }
            const original = await this.readTarget(targetId, 'reading the message an encrypted edit or reaction targets');
            const secret = (0, baileys_secret_payload_1.messageSecretOf)(original?.message);
            if (!original || !secret) {
                this.host.logger.debug('Cannot read an encrypted edit or reaction: the message it targets is not stored', {
                    action: 'baileys_encrypted_unreadable',
                    msgId: msg.key.id ?? 'unknown',
                    targetId,
                });
                return undefined;
            }
            const user = this.host.getSocketOrNull()?.user;
            const own = [user?.id, user?.lid].filter((jid) => !!jid).map(baileys_secret_payload_1.withoutDevice);
            const withPhone = (forms) => forms.flatMap(jid => {
                const neutral = jid.endsWith('@lid') ? this.host.toNeutralJid(jid) : '';
                return neutral.endsWith('@c.us') ? [jid, `${(0, wa_id_1.userPart)(neutral)}@s.whatsapp.net`] : [jid];
            });
            const plaintext = (0, baileys_secret_payload_1.decryptSecretPayload)({
                kind: isEdit ? 'edit' : 'reaction',
                secret,
                iv,
                payload,
                targetId,
                targetAuthors: withPhone((0, baileys_secret_payload_1.senderForms)(original.key, own)),
                modifiers: withPhone((0, baileys_secret_payload_1.senderForms)(msg.key, own)),
            });
            if (!plaintext) {
                this.host.logger.debug('An encrypted edit or reaction did not authenticate against its target', {
                    action: 'baileys_encrypted_unauthentic',
                    msgId: msg.key.id ?? 'unknown',
                    targetId,
                });
                return undefined;
            }
            if (isEdit) {
                const protocolMessage = b.proto.Message.decode(plaintext).protocolMessage;
                if (protocolMessage?.type !== b.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT ||
                    protocolMessage.key?.id !== targetId) {
                    return undefined;
                }
                return { content: { protocolMessage }, contentType: 'protocolMessage' };
            }
            const reaction = b.proto.Message.ReactionMessage.decode(plaintext);
            return {
                content: { reactionMessage: { key: targetKey, text: reaction.text ?? '' } },
                contentType: 'reactionMessage',
            };
        }
        catch (error) {
            this.host.logger.debug('Could not read an encrypted edit or reaction', {
                action: 'baileys_encrypted_failed',
                msgId: msg.key.id ?? 'unknown',
                error: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        }
    }
    async targetsForeignMessage(targetId, key, checkAuthor, kind, inbound) {
        if (!targetId)
            return false;
        let waitedFor;
        let heldUntil;
        let reread = false;
        for (;;) {
            const removals = this.removalsOf(targetId);
            const found = await this.readTarget(targetId, 'checking what an edit, revoke or reaction targets');
            const removedSince = waitedFor !== undefined && this.removalsOf(targetId) !== waitedFor.removals;
            const original = found && !found.processing ? found.key : removedSince ? undefined : (found?.key ?? waitedFor?.key);
            if (!original || !this.readsAsForeign(original, key, checkAuthor, kind))
                return false;
            const processing = found?.processing;
            const hold = this.outcomesPending.get(targetId);
            if (hold) {
                waitedFor ??= { key: original, removals };
                heldUntil ??= Date.now() + BaileysEvents.OUTCOME_HOLD_MS;
                const left = heldUntil - Date.now();
                if (left > 0 && (await this.parkUntil(hold.ended, left, inbound)))
                    continue;
            }
            else if (!waitedFor && processing && original.remoteJid !== 'status@broadcast' && original.fromMe !== true) {
                waitedFor = { key: original, removals };
                if (await this.parkUntil(processing, 3 * (0, inbound_media_cap_1.inboundMediaTimeoutMs)(), inbound))
                    continue;
            }
            if (!reread && this.removalsOf(targetId) !== removals) {
                reread = true;
                continue;
            }
            this.host.logger.warn('Dropping an edit, revoke or reaction aimed at a message from another chat or author', {
                msgId: key.id ?? 'unknown',
                targetId,
                remoteJid: key.remoteJid,
            });
            return true;
        }
    }
    async parkUntil(until, limitMs, inbound) {
        if (this.changesParked >= BaileysEvents.CHANGES_PARKED_LIMIT)
            return false;
        this.changesParked++;
        try {
            inbound?.ticket?.drop();
            const wait = () => new Promise(resolve => {
                let wake = resolve;
                const end = () => {
                    clearTimeout(timer);
                    wake?.();
                    wake = null;
                };
                const timer = setTimeout(end, limitMs);
                timer.unref();
                until.then(end, end);
            });
            await (inbound?.yieldSlot ? inbound.yieldSlot(wait) : wait());
            return true;
        }
        finally {
            this.changesParked--;
        }
    }
    readsAsForeign(original, key, checkAuthor, kind) {
        const broadcast = kind === 'reaction' && !!original.remoteJid?.endsWith('@broadcast');
        if (broadcast && original.fromMe === true)
            return false;
        const originalChats = [original.remoteJid, original.remoteJidAlt];
        if (broadcast && original.remoteJid !== 'status@broadcast')
            originalChats.push(original.participant);
        const neutral = (jid) => this.host.toNeutralJid(jid);
        return (differentWaIds(originalChats, [key.remoteJid, key.remoteJidAlt], neutral) ||
            (checkAuthor &&
                ((original.fromMe === true) !== (key.fromMe === true) ||
                    (key.fromMe !== true &&
                        differentWaIds([original.participant, original.participantAlt], [key.participant, key.participantAlt], neutral)))));
    }
    changeStoredMessage(messageId, change) {
        if (!messageId)
            return;
        const apply = async () => this.host.updateStoredMessage(messageId, change);
        const inFlight = this.inboundInFlight.get(messageId)?.done;
        void (inFlight ? inFlight.then(apply) : apply()).catch(err => this.host.logger.warn('Failed to apply an edit or delete to the message store', {
            msgId: messageId,
            error: err instanceof Error ? err.message : String(err),
        }));
    }
    mayChange(target, envelope, isDelete) {
        const neutral = (jids) => jids.filter((jid) => !!jid).map(jid => this.host.toNeutralJid(jid));
        const chat = (key) => neutral([key.remoteJid, key.remoteJidAlt]);
        const author = (key) => key.fromMe === true ? ['fromMe'] : key.participant ? neutral([key.participant, key.participantAlt]) : chat(key);
        const overlap = (a, b) => a.some(jid => b.includes(jid));
        if (!overlap(chat(target), chat(envelope)))
            return false;
        const inGroup = chat(target).some(jid => (0, wa_id_1.parseWaId)(jid).kind === 'group');
        return (isDelete && inGroup) || overlap(author(target), author(envelope));
    }
    handleMessagesUpdate(updates) {
        for (const u of updates) {
            const status = (0, baileys_message_mapper_1.mapBaileysStatus)(u.update?.status);
            if (status && u.key?.id) {
                const chatId = u.key.remoteJid ? this.host.toNeutralJid(u.key.remoteJid) : undefined;
                this.host.getOnMessageAck()?.(u.key.id, status, chatId);
            }
            for (const rsvp of u.update?.eventResponses ?? []) {
                void this.emitEventResponse(u.key, rsvp).catch(err => this.host.logger.warn('Failed to report an event response', {
                    msgId: u.key?.id,
                    error: err instanceof Error ? err.message : String(err),
                }));
            }
        }
    }
    handleMessageReceiptUpdate(updates) {
        const onReceipt = this.host.getOnMessageReceipt();
        if (!onReceipt) {
            return;
        }
        const isSelf = this.selfMatcher();
        for (const { key, receipt } of Array.isArray(updates) ? updates : []) {
            if (!key?.id || !key.remoteJid || key.fromMe !== true || !receipt?.userJid || isSelf(receipt.userJid)) {
                continue;
            }
            const stamps = [
                ['delivered', receipt.receiptTimestamp],
                ['read', receipt.readTimestamp],
                ['played', receipt.playedTimestamp],
            ];
            for (const [status, ts] of stamps) {
                if (ts == null)
                    continue;
                const event = {
                    messageId: key.id,
                    chatId: this.host.toNeutralJid(key.remoteJid),
                    participant: this.host.toNeutralJid(receipt.userJid),
                    status,
                    timestamp: (0, baileys_history_1.toUnixSeconds)(ts),
                };
                onReceipt(event);
            }
        }
    }
    selfMatcher() {
        const selfJid = this.host.normalizedSelfJid();
        if (!selfJid) {
            return () => false;
        }
        const phone = (0, wa_id_1.userPart)(selfJid);
        const lid = this.host.getSocketOrNull()?.user?.lid;
        const lidUser = lid ? (0, wa_id_1.userPart)(lid) : undefined;
        return (jid) => {
            if (!jid)
                return false;
            const { kind, userPart: user } = (0, wa_id_1.parseWaId)(jid);
            if (kind === 'user')
                return user === phone;
            if (kind !== 'lid')
                return false;
            if (lidUser !== undefined)
                return user === lidUser;
            return (0, wa_id_1.userPart)(this.host.toNeutralJid(jid)) === phone;
        };
    }
    async emitEventResponse(eventKey, rsvp) {
        const callback = this.host.getOnEventResponse();
        const envelope = rsvp.eventResponseMessageKey;
        if (!callback || !eventKey?.id || !eventKey.remoteJid || !envelope?.id)
            return;
        this.host.recordKeyLidMappings(envelope);
        const stored = await this.readStoredMessage(eventKey.id, 'reading the event an RSVP answers');
        if (stored &&
            differentWaIds([stored.key.remoteJid, stored.key.remoteJidAlt], [envelope.remoteJid, envelope.remoteJidAlt], jid => this.host.toNeutralJid(jid))) {
            this.host.logger.warn('Dropping an event response sent in a chat other than its event', {
                msgId: eventKey.id,
                responseMessageId: envelope.id,
                remoteJid: envelope.remoteJid,
            });
            return;
        }
        const fromMe = envelope.fromMe === true;
        const chatJid = envelope.remoteJid ?? eventKey.remoteJid;
        const responder = (0, baileys_message_mapper_1.keyParticipant)(envelope) ?? (fromMe ? this.host.normalizedSelfJid() : chatJid);
        if (!responder)
            return;
        const event = {
            eventMessageId: eventKey.id,
            chatId: this.host.toNeutralJid(chatJid),
            responderId: this.host.toNeutralJid(responder),
            fromMe,
            response: (0, baileys_message_mapper_1.mapBaileysEventResponseType)(rsvp.response?.response),
            responseMessageId: envelope.id,
            timestamp: this.toEditUnixSeconds(rsvp.senderTimestampMs ?? rsvp.response?.timestampMs, Math.floor(Date.now() / 1000)),
        };
        const guests = rsvp.response?.extraGuestCount;
        if (typeof guests === 'number' && Number.isFinite(guests))
            event.extraGuestCount = guests;
        const known = this.host.findContact(responder);
        if (known?.name || known?.pushName) {
            event.contact = {
                ...(known.name ? { name: known.name } : {}),
                ...(known.pushName ? { pushName: known.pushName } : {}),
            };
        }
        if (stored?.message) {
            const b = await this.host.loadLib();
            const name = b.normalizeMessageContent(stored.message)?.eventMessage?.name;
            if (name)
                event.eventName = name;
        }
        callback(event);
    }
    handleGroupParticipantsUpdate(event) {
        const kind = event.action === 'add' ? 'join' : event.action === 'remove' ? 'leave' : undefined;
        if (!kind || !event.id) {
            return;
        }
        const participantIds = (Array.isArray(event.participants) ? event.participants : [])
            .map(entry => this.toNeutralGroupParticipantId(entry))
            .filter((jid) => jid !== null);
        const payload = {
            kind,
            groupId: this.host.toNeutralJid(event.id),
            participantIds,
            timestamp: Math.floor(Date.now() / 1000),
        };
        const actor = event.authorPn ?? event.author;
        if (actor) {
            payload.actorId = this.host.toNeutralJid(actor);
        }
        this.host.getOnGroupEvent()?.(payload);
    }
    handleGroupsUpsert(groups) {
        const selfJid = this.host.normalizedSelfJid();
        if (!selfJid) {
            return;
        }
        const isSelf = this.selfMatcher();
        for (const group of Array.isArray(groups) ? groups : []) {
            if (!group ||
                ((isSelf(group.authorPn) || isSelf(group.author)) && (isSelf(group.ownerPn) || isSelf(group.owner)))) {
                continue;
            }
            this.handleGroupParticipantsUpdate({
                id: group.id,
                author: group.author,
                authorPn: group.authorPn,
                action: 'add',
                participants: [selfJid],
            });
        }
    }
    handleGroupJoinRequest(event) {
        if (event.action !== 'created' || !event.id) {
            return;
        }
        const participant = event.participantPn ?? event.participant;
        if (!participant) {
            return;
        }
        const payload = {
            kind: 'join_request',
            groupId: this.host.toNeutralJid(event.id),
            participantIds: [this.host.toNeutralJid(participant)],
            timestamp: Math.floor(Date.now() / 1000),
        };
        const actor = event.authorPn ?? event.author;
        if (actor) {
            payload.actorId = this.host.toNeutralJid(actor);
        }
        this.host.getOnGroupEvent()?.(payload);
    }
    handleGroupsUpdate(updates) {
        for (const update of Array.isArray(updates) ? updates : []) {
            if (!update?.id) {
                continue;
            }
            if ('participants' in update || 'creation' in update || 'subjectTime' in update || 'owner' in update) {
                continue;
            }
            const changes = {};
            if (typeof update.subject === 'string')
                changes.subject = update.subject;
            if (typeof update.desc === 'string')
                changes.description = update.desc;
            if (typeof update.announce === 'boolean')
                changes.announce = update.announce;
            if (typeof update.restrict === 'boolean')
                changes.locked = update.restrict;
            const payload = {
                kind: 'update',
                groupId: this.host.toNeutralJid(update.id),
                participantIds: [],
                changes,
                timestamp: Math.floor(Date.now() / 1000),
            };
            const actor = update.authorPn ?? update.author;
            if (actor) {
                payload.actorId = this.host.toNeutralJid(actor);
            }
            this.host.getOnGroupEvent()?.(payload);
        }
    }
    handleCallEvents(calls) {
        for (const call of Array.isArray(calls) ? calls : []) {
            if (!call || !call.id || !call.from) {
                continue;
            }
            if (call.status !== 'offer') {
                this.reportCallOutcome(call);
                continue;
            }
            if (call.offline) {
                continue;
            }
            const selfJid = this.host.normalizedSelfJid();
            if (selfJid) {
                const self = this.host.toNeutralJid(selfJid);
                if (this.host.toNeutralJid(call.from) === self || this.host.toNeutralJid(call.chatId) === self) {
                    continue;
                }
            }
            const published = {
                from: this.host.toNeutralJid(call.callerPn ?? call.from),
                isVideo: call.isVideo === true,
                isGroup: call.isGroup === true,
            };
            if (!this.cacheLiveCall(call.id, call.from, published)) {
                continue;
            }
            const payload = {
                callId: call.id,
                from: this.host.toNeutralJid(call.callerPn ?? call.from),
                isVideo: call.isVideo === true,
                isGroup: call.isGroup === true,
                timestamp: call.date instanceof Date && !Number.isNaN(call.date.getTime())
                    ? Math.floor(call.date.getTime() / 1000)
                    : Math.floor(Date.now() / 1000),
            };
            this.host.getOnCall()?.(payload);
        }
    }
    reportCallOutcome(call) {
        if (call.status === 'terminate') {
            this.liveCalls.delete(call.id);
            return;
        }
        const outcome = CALL_OUTCOMES[call.status];
        if (!outcome)
            return;
        const live = this.liveCalls.get(call.id);
        this.liveCalls.delete(call.id);
        if (call.offline)
            return;
        if (!live)
            return;
        this.host.getOnCallOutcome()?.({
            callId: call.id,
            from: this.host.toNeutralJid(call.callerPn ?? call.from),
            outcome,
            isVideo: call.isVideo === true,
            isGroup: call.isGroup === true,
            timestamp: call.date instanceof Date && !Number.isNaN(call.date.getTime())
                ? Math.floor(call.date.getTime() / 1000)
                : Math.floor(Date.now() / 1000),
        });
    }
    handlePresenceUpdate(update) {
        const report = this.host.getOnPresenceUpdate();
        if (!report || !update?.id || !update.presences)
            return;
        const participants = [];
        for (const [participant, data] of Object.entries(update.presences)) {
            const state = data?.lastKnownPresence;
            if (!state || !PRESENCE_STATES.has(state))
                continue;
            participants.push({
                id: this.host.toNeutralJid(participant),
                state,
                ...(typeof data.lastSeen === 'number' && Number.isFinite(data.lastSeen) ? { lastSeen: data.lastSeen } : {}),
            });
        }
        if (participants.length === 0)
            return;
        const groupOnlineCount = Object.values(update.presences).find(p => typeof p?.groupOnlineCount === 'number')?.groupOnlineCount;
        this.host.getOnPresenceUpdate()?.({
            chatId: this.host.toNeutralJid(update.id),
            participants,
            ...(typeof groupOnlineCount === 'number' ? { groupOnlineCount } : {}),
        });
    }
    cacheLiveCall(callId, callFrom, published) {
        const now = Date.now();
        for (const [id, entry] of this.liveCalls) {
            if (entry.expiresAt <= now) {
                this.liveCalls.delete(id);
            }
        }
        const isNewCall = !this.liveCalls.has(callId);
        this.liveCalls.set(callId, { callFrom, expiresAt: now + BaileysEvents.LIVE_CALL_TTL_MS, ...published });
        return isNewCall;
    }
    async rejectCall(callId) {
        const entry = this.liveCalls.get(callId);
        if (!entry || entry.expiresAt <= Date.now()) {
            this.liveCalls.delete(callId);
            throw new call_not_found_error_1.CallNotFoundError(callId);
        }
        const sock = this.host.getSocketOrNull();
        if (!sock) {
            throw new engine_not_ready_error_1.EngineNotReadyError('Cannot reject a call before the engine is initialized.');
        }
        this.liveCalls.delete(callId);
        const clears = this.liveCalls.clears;
        try {
            await (0, baileys_query_deadline_1.withQueryDeadline)(sock.rejectCall(callId, entry.callFrom), baileys_query_deadline_1.BAILEYS_QUERY_BUDGET_MS, 'WhatsApp did not confirm the call rejection in time');
        }
        catch (err) {
            if (this.liveCalls.clears === clears && !this.liveCalls.has(callId) && entry.expiresAt > Date.now()) {
                this.liveCalls.set(callId, entry);
            }
            throw err;
        }
        this.host.getOnCallOutcome()?.({
            callId,
            from: entry.from,
            outcome: 'rejected',
            isVideo: entry.isVideo,
            isGroup: entry.isGroup,
            timestamp: Math.floor(Date.now() / 1000),
        });
    }
    toNeutralGroupParticipantId(entry) {
        if (typeof entry === 'string') {
            return entry ? this.host.toNeutralJid(entry) : null;
        }
        if (entry && typeof entry === 'object') {
            const e = entry;
            const jid = [e.phoneNumber, e.id, e.lid].find((v) => typeof v === 'string' && v.length > 0);
            return jid ? this.host.toNeutralJid(jid) : null;
        }
        return null;
    }
    async downloadInboundMediaCapped(msg, maxBytes) {
        let stream;
        let timedOut = false;
        let releaseSlot = () => undefined;
        const deadlinePassed = new Promise(resolve => {
            releaseSlot = () => resolve(Buffer.alloc(0));
        });
        const body = async () => {
            if (timedOut) {
                return Buffer.alloc(0);
            }
            const b = await this.host.loadLib();
            const assertWhatsAppSource = (m) => {
                if (!isWhatsAppMediaSource(b, m.message)) {
                    throw new Error('Inbound media address is not a WhatsApp media host; not fetched');
                }
                return m;
            };
            assertWhatsAppSource(msg);
            const sock = this.host.getSocket();
            const dispatcher = this.host.getFetchDispatcher();
            stream = (await b.downloadMediaMessage(msg, 'stream', dispatcher ? { options: { dispatcher } } : {}, {
                logger: (0, baileys_logger_1.createSilentLogger)(),
                reuploadRequest: async (m) => assertWhatsAppSource(await sock.updateMediaMessage(m)),
            }));
            if (timedOut) {
                stream.destroy?.();
                return Buffer.alloc(0);
            }
            const chunks = [];
            let total = 0;
            for await (const chunk of stream) {
                if (timedOut) {
                    break;
                }
                total += chunk.length;
                if (total > maxBytes) {
                    stream.destroy?.();
                    return { overflowBytes: total };
                }
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        };
        const download = (0, inbound_media_cap_1.runUnderGlobalMediaGate)(() => {
            const run = body();
            run.catch(() => undefined);
            return Promise.race([run, deadlinePassed]);
        });
        return (0, inbound_media_cap_1.withInboundDownloadTimeout)(download, (0, inbound_media_cap_1.inboundMediaTimeoutMs)(), () => {
            timedOut = true;
            stream?.destroy?.();
            releaseSlot();
        });
    }
    async resolveInboundMedia(msg, contentType, content, b, skipMediaDownload, room) {
        if (!isBaileysMediaType(contentType)) {
            return undefined;
        }
        if (skipMediaDownload || !(0, inbound_media_cap_1.isMediaDownloadEnabled)()) {
            const normalizedContent = b.normalizeMessageContent(content) ?? content;
            const subMessage = mediaSubMessage(normalizedContent);
            return {
                mimetype: subMessage?.mimetype ?? '',
                filename: normalizedContent.documentMessage?.fileName ?? undefined,
                omitted: true,
                sizeBytes: (0, inbound_media_cap_1.coerceDeclaredSize)(subMessage?.fileLength),
            };
        }
        const normalizedContent = b.normalizeMessageContent(content) ?? content;
        const subMessage = mediaSubMessage(normalizedContent);
        const mimetype = subMessage?.mimetype ?? '';
        const filename = normalizedContent.documentMessage?.fileName ?? undefined;
        const maxBytes = (0, inbound_media_cap_1.inboundMediaMaxBytes)();
        const declared = (0, inbound_media_cap_1.coerceDeclaredSize)(subMessage?.fileLength);
        if (declared > maxBytes) {
            this.host.logger.warn('Inbound media declared size exceeds MEDIA_DOWNLOAD_MAX_BYTES; skipped download', {
                msgId: msg.key.id,
                sizeBytes: declared,
            });
            return { mimetype, filename, omitted: true, sizeBytes: declared };
        }
        try {
            const ticket = room?.ticket;
            if (ticket) {
                const granted = ticket.reserve();
                const yieldSlot = room?.yieldSlot ?? ((fn) => fn());
                if (!(granted === true || (granted !== false && (await yieldSlot(() => granted))))) {
                    this.host.logger.warn('No room for inbound media within the wait; emitting the omitted marker', {
                        msgId: msg.key.id,
                        sizeBytes: declared,
                    });
                    return { mimetype, filename, omitted: true, sizeBytes: declared };
                }
            }
            const buf = await this.downloadInboundMediaCapped(msg, maxBytes);
            if (buf === null) {
                this.host.logger.warn('Inbound media download passed MEDIA_DOWNLOAD_TIMEOUT_MS; emitting omitted marker', {
                    msgId: msg.key.id,
                    sizeBytes: declared,
                });
                return { mimetype, filename, omitted: true, sizeBytes: declared };
            }
            if (!Buffer.isBuffer(buf)) {
                const sizeBytes = buf.overflowBytes;
                this.host.logger.warn('Inbound media download exceeded MEDIA_DOWNLOAD_MAX_BYTES; emitting omitted marker', {
                    msgId: msg.key.id,
                    sizeBytes,
                });
                return { mimetype, filename, omitted: true, sizeBytes };
            }
            return (0, inbound_media_cap_1.capInboundMedia)({
                mimetype,
                filename,
                sizeBytes: buf.byteLength,
                toBase64: () => buf.toString('base64'),
            });
        }
        catch (err) {
            this.host.logger.warn('Inbound media download failed; emitting the omitted marker', {
                error: err instanceof Error ? err.message : String(err),
                msgId: msg.key.id,
            });
            return { mimetype, filename, omitted: true, sizeBytes: declared };
        }
    }
    async mapMessage(msg, contentType, opts) {
        const b = await this.host.loadLib();
        const content = msg.message ?? {};
        const normalized = b.normalizeMessageContent(content) ?? content;
        const body = (0, baileys_message_mapper_1.extractBaileysBody)(normalized);
        const location = (0, baileys_message_mapper_1.extractBaileysLocation)(normalized, contentType);
        const media = await this.resolveInboundMedia(msg, contentType, content, b, opts?.skipMediaDownload === true, opts);
        const context = (0, baileys_message_mapper_1.extractBaileysContext)(normalized);
        const commerce = (0, baileys_message_mapper_1.extractBaileysCommerce)(normalized, contentType);
        const button = (0, baileys_message_mapper_1.extractBaileysButtonReply)(normalized, contentType);
        const buttons = (0, baileys_message_mapper_1.extractBaileysButtons)(normalized, contentType);
        return (0, baileys_message_mapper_1.buildIncomingMessageFromBaileys)({
            id: msg.key.id ?? '',
            remoteJid: msg.key.remoteJid,
            fromMe: msg.key.fromMe === true,
            participant: (0, baileys_message_mapper_1.keyParticipant)(msg.key),
            body,
            contentType,
            isPtt: normalized.audioMessage?.ptt === true,
            timestamp: (0, baileys_history_1.toUnixSeconds)(msg.messageTimestamp),
            pushName: msg.pushName ?? undefined,
            selfJid: this.host.normalizedSelfJid(),
            media,
            location,
            quotedMessage: context.quotedMessage,
            order: commerce.order,
            product: commerce.product,
            poll: (0, baileys_message_mapper_1.extractBaileysPoll)(normalized),
            button,
            buttons,
            isCatalogShare: (0, baileys_message_mapper_1.isBaileysCatalogShare)(normalized),
            ephemeralDuration: context.ephemeralDuration,
            mentionedJids: context.mentionedJids,
            backgroundArgb: context.backgroundArgb,
            font: context.font,
        }, jid => this.host.toNeutralJid(jid));
    }
    toEditUnixSeconds(timestampMs, fallback) {
        if (timestampMs == null)
            return (0, baileys_history_1.toUnixSeconds)(fallback);
        const milliseconds = typeof timestampMs === 'number' ? timestampMs : timestampMs.toNumber();
        return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : (0, baileys_history_1.toUnixSeconds)(fallback);
    }
}
exports.BaileysEvents = BaileysEvents;
//# sourceMappingURL=baileys-events.js.map