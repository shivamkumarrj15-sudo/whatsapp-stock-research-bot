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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageTypeBackfillService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const message_entity_1 = require("./entities/message.entity");
const logger_service_1 = require("../../common/services/logger.service");
let MessageTypeBackfillService = class MessageTypeBackfillService {
    messageRepository;
    logger = (0, logger_service_1.createLogger)('MessageTypeBackfill');
    constructor(messageRepository) {
        this.messageRepository = messageRepository;
    }
    async onApplicationBootstrap() {
        const conversions = [
            { from: ['chat'], to: 'text' },
            { from: ['buttons_response', 'list_response', 'template_button_reply'], to: 'text' },
            { from: ['ptt'], to: 'voice' },
            { from: ['vcard', 'multi_vcard'], to: 'contact' },
        ];
        let total = 0;
        try {
            for (const { from, to } of conversions) {
                const result = await this.messageRepository.update({ type: from.length === 1 ? from[0] : (0, typeorm_2.In)(from) }, { type: to });
                total += result.affected ?? 0;
            }
            if (total > 0) {
                this.logger.log(`Backfilled ${total} legacy message type(s) to the neutral vocabulary`, {
                    action: 'message_type_backfill',
                });
            }
        }
        catch (error) {
            this.logger.error('Failed to backfill legacy message types', error instanceof Error ? error.stack : String(error), { action: 'message_type_backfill_failed' });
        }
    }
};
exports.MessageTypeBackfillService = MessageTypeBackfillService;
exports.MessageTypeBackfillService = MessageTypeBackfillService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(message_entity_1.Message, 'data')),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], MessageTypeBackfillService);
//# sourceMappingURL=message-type-backfill.service.js.map