"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplate = renderTemplate;
const PLACEHOLDER_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}|\{(\w+)\}/g;
function renderTemplate(body, vars = {}) {
    if (!body) {
        return body;
    }
    return body.replace(PLACEHOLDER_PATTERN, (match, doubleKey, singleKey) => {
        const key = doubleKey ?? singleKey;
        if (key !== undefined && Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null) {
            return String(vars[key]);
        }
        return match;
    });
}
//# sourceMappingURL=template-render.js.map