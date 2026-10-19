"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provablyDifferent = provablyDifferent;
exports.mutationTargetsForeignRow = mutationTargetsForeignRow;
const message_entity_1 = require("../message/entities/message.entity");
const wa_id_1 = require("../../engine/identity/wa-id");
function phoneKey(local) {
    return local
        .replace(/\D/g, '')
        .replace(/^55(\d{2})9(\d{8})$/, '55$1$2')
        .replace(/^521(\d{10})$/, '52$1')
        .replace(/^549(\d+)$/, '54$1');
}
function entityOf(jid) {
    const parsed = (0, wa_id_1.parseWaId)(jid);
    if (parsed.kind === 'user')
        return { kind: 'user', id: phoneKey(parsed.userPart) };
    if (parsed.kind !== 'unknown')
        return { kind: parsed.kind, id: parsed.userPart };
    return !jid.includes('@') && /^\+?\d[\d -]*$/.test(jid.trim()) ? { kind: 'user', id: phoneKey(jid) } : null;
}
const isPerson = (kind) => kind === 'user' || kind === 'lid';
function isOwnBroadcast(row) {
    const kind = entityOf(row.chatId)?.kind;
    return row.direction === message_entity_1.MessageDirection.OUTGOING && (kind === 'broadcast' || kind === 'status');
}
function receivedThroughList(row, chatId) {
    return (row.direction === message_entity_1.MessageDirection.INCOMING &&
        entityOf(row.chatId)?.kind === 'broadcast' &&
        !provablyDifferent(row.author, chatId));
}
function provablyDifferent(a, b) {
    if (!a || !b || a === b)
        return false;
    const left = entityOf(a);
    const right = entityOf(b);
    if (!left || !right)
        return false;
    if (left.kind === right.kind)
        return left.id !== right.id;
    return !(isPerson(left.kind) && isPerson(right.kind));
}
function mutationTargetsForeignRow(row, source) {
    const listed = (source.kind === 'reaction' && isOwnBroadcast(row)) || receivedThroughList(row, source.chatId);
    if (!listed && provablyDifferent(row.chatId, source.chatId))
        return 'chat';
    const group = source.chatId.endsWith('@g.us') || row.chatId.endsWith('@g.us');
    const authorOnly = source.kind === 'edit' || (source.kind === 'revoke' && !group);
    if (authorOnly && source.fromMe !== undefined) {
        const expected = source.fromMe ? message_entity_1.MessageDirection.OUTGOING : message_entity_1.MessageDirection.INCOMING;
        if (row.direction && row.direction !== expected)
            return 'direction';
    }
    if (source.kind === 'edit' && group && source.fromMe === false && provablyDifferent(row.author, source.author)) {
        return 'author';
    }
    return null;
}
//# sourceMappingURL=message-mutation-guard.js.map