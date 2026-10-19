"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MuteChatDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const send_message_dto_1 = require("../../message/dto/send-message.dto");
class MuteChatDto {
    chatId;
    muteUntil;
}
exports.MuteChatDto = MuteChatDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        maxLength: send_message_dto_1.CHAT_ID_MAX_LENGTH,
        description: "Chat ID in the active engine's native format (e.g. 1234567890-123@g.us on whatsapp-web.js)",
        example: '1234567890-123@g.us',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(send_message_dto_1.CHAT_ID_MAX_LENGTH),
    (0, class_validator_1.Matches)(/^[^\s@]+@[^\s@]+$/, {
        message: 'chatId must be a valid chat JID in the form localpart@host',
    }),
    __metadata("design:type", String)
], MuteChatDto.prototype, "chatId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Absolute epoch-MILLISECONDS timestamp at which the mute expires, or `null` to unmute now. ' +
            'Required — omitting it is rejected rather than guessed, because the two plausible readings ' +
            '(unmute vs mute forever) are opposites. To mute indefinitely, send a far-future timestamp. ' +
            'Milliseconds, not seconds: a seconds-scale value is an instant in 1970, so the mute expires ' +
            'immediately while the request still answers 200.',
        example: 1800000000000,
        type: 'integer',
        nullable: true,
        minimum: 1,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.muteUntil !== null),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Object)
], MuteChatDto.prototype, "muteUntil", void 0);
//# sourceMappingURL=mute-chat.dto.js.map