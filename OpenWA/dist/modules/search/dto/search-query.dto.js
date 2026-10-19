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
exports.SearchQueryDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const message_entity_1 = require("../../message/entities/message.entity");
const strict_boolean_1 = require("../../../common/utils/strict-boolean");
const search_constants_1 = require("../search.constants");
class SearchQueryDto {
    q;
    sessionId;
    chatId;
    from;
    direction;
    type;
    dateFrom;
    dateTo;
    limit;
    offset;
}
exports.SearchQueryDto = SearchQueryDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: `Search term (required, non-empty, at most ${search_constants_1.SEARCH_QUERY_MAX_LENGTH} characters and ${search_constants_1.SEARCH_TERMS_MAX} words)`,
        maxLength: search_constants_1.SEARCH_QUERY_MAX_LENGTH,
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(search_constants_1.SEARCH_QUERY_MAX_LENGTH),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "q", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Restrict to a single session' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "sessionId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Restrict to a single chat id' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "chatId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Sender filter' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "from", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: message_entity_1.MessageDirection, description: 'incoming | outgoing' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(message_entity_1.MessageDirection),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "direction", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Message type filter (compared against stored messages.type)' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchQueryDto.prototype, "type", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Epoch-ms lower bound (inclusive)', type: Number }),
    (0, strict_boolean_1.ToStrictNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "dateFrom", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Epoch-ms upper bound (inclusive)', type: Number }),
    (0, strict_boolean_1.ToStrictNumber)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "dateTo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'Max hits to return', type: 'integer', minimum: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "limit", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: `Pagination offset, at most ${search_constants_1.SEARCH_OFFSET_MAX}`,
        type: 'integer',
        minimum: 0,
        maximum: search_constants_1.SEARCH_OFFSET_MAX,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, strict_boolean_1.ToStrictNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(search_constants_1.SEARCH_OFFSET_MAX),
    __metadata("design:type", Number)
], SearchQueryDto.prototype, "offset", void 0);
//# sourceMappingURL=search-query.dto.js.map