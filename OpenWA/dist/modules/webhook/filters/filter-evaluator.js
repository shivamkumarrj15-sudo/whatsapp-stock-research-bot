"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateFilters = evaluateFilters;
const filter_types_1 = require("./filter-types");
const wa_id_1 = require("../../../engine/identity/wa-id");
const canonicalActor = (jid, resolve) => (0, wa_id_1.toNeutralJid)(jid, resolve).toLowerCase();
const canonicalInput = (value, resolve) => {
    const trimmed = value.trim();
    if (trimmed && !trimmed.includes('@')) {
        return `${trimmed.replace(/\D/g, '') || trimmed}@c.us`.toLowerCase();
    }
    return (0, wa_id_1.toNeutralJid)(trimmed, resolve).toLowerCase();
};
const toStringArray = (value) => Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
function evaluateCondition(def, condition, data, resolve) {
    const { operator, value, caseSensitive = false } = condition;
    const resolved = def.resolve(data);
    switch (def.kind) {
        case 'id': {
            const candidates = new Set(toStringArray(value).map(v => canonicalInput(v, resolve)));
            const actual = typeof resolved === 'string' ? resolved : undefined;
            const isMatch = actual != null && candidates.has(canonicalActor(actual, resolve));
            return operator === 'isNot' ? !isMatch : isMatch;
        }
        case 'enum': {
            const candidates = new Set(toStringArray(value));
            const actual = typeof resolved === 'string' ? resolved : undefined;
            const isMatch = actual != null && candidates.has(actual);
            return operator === 'isNot' ? !isMatch : isMatch;
        }
        case 'idArray': {
            const candidates = new Set(toStringArray(value).map(v => canonicalInput(v, resolve)));
            const actual = toStringArray(resolved).map(jid => canonicalActor(jid, resolve));
            const intersects = actual.some(v => candidates.has(v));
            return operator === 'isNot' ? !intersects : intersects;
        }
        case 'boolean':
            return resolved === (value === true);
        case 'text': {
            if (typeof value !== 'string')
                return true;
            const haystackRaw = typeof resolved === 'string' ? resolved : '';
            const haystack = caseSensitive ? haystackRaw : haystackRaw.toLowerCase();
            const needle = caseSensitive ? value : value.toLowerCase();
            if (operator === 'equals')
                return haystack === needle;
            return haystack.includes(needle);
        }
        default:
            return true;
    }
}
function evaluateFilters(filters, event, data, resolve) {
    if (!filters || !Array.isArray(filters.conditions) || filters.conditions.length === 0) {
        return true;
    }
    const family = (0, filter_types_1.eventFamily)(event);
    for (const condition of filters.conditions) {
        const def = (0, filter_types_1.getFieldDefinition)(family, condition.field);
        if (!def)
            continue;
        if (!evaluateCondition(def, condition, data, resolve))
            return false;
    }
    return true;
}
//# sourceMappingURL=filter-evaluator.js.map