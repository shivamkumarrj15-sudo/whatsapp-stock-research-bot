"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatIdSchema = void 0;
const zod_1 = require("zod");
const send_message_dto_1 = require("../../modules/message/dto/send-message.dto");
exports.chatIdSchema = zod_1.z.string().min(1).max(send_message_dto_1.CHAT_ID_MAX_LENGTH);
//# sourceMappingURL=chat-id-schema.js.map