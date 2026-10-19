import { Repository } from 'typeorm';
import { Message } from '../message/entities/message.entity';
import { KeyedMutationQueue } from '../../common/utils/keyed-mutation-queue';
import { LoggerService } from '../../common/services/logger.service';
import { EventsGateway } from '../events/events.gateway';
import { WebhookService } from '../webhook/webhook.service';
import { ReactionEvent, EditedMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { type MutationSource } from './message-mutation-guard';
export declare class MessageMutationProjector {
    private readonly messageRepository;
    private readonly eventsGateway;
    private readonly webhookService;
    private readonly messageMutations;
    private readonly logger;
    constructor(messageRepository: Repository<Message>, eventsGateway: EventsGateway, webhookService: WebhookService, messageMutations: KeyedMutationQueue, logger: LoggerService);
    applyReactionQueued(id: string, event: ReactionEvent, needsRow?: boolean): void;
    applyMessageEditQueued(id: string, message: EditedMessage, needsRow?: boolean): void;
    enqueueMessageMutation(id: string, messageId: string, work: () => Promise<void>): void;
    foreignRowReason(sessionId: string, waMessageId: string, source: MutationSource): Promise<string | null>;
    storedRowVerdict(sessionId: string, waMessageId: string, source: MutationSource): Promise<{
        exists: boolean;
        reason: string | null;
    }>;
    private applyReaction;
    private applyMessageEdit;
    recordOutboundMessageEdit(sessionId: string, messageId: string, body: string, source?: MutationSource): Promise<void>;
}
