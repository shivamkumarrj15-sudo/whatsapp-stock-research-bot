import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Message } from '../message/entities/message.entity';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { LoggerService } from '../../common/services/logger.service';
export declare function persistHistoryMessages(messageRepository: Repository<Message>, configService: ConfigService | undefined, id: string, messages: IncomingMessage[], logger: LoggerService, isLive: () => boolean, notifyRevoked?: (row: Message) => void): Promise<IncomingMessage[]>;
