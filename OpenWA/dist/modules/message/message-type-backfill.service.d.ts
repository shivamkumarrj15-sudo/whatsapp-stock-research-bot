import { OnApplicationBootstrap } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';
export declare class MessageTypeBackfillService implements OnApplicationBootstrap {
    private readonly messageRepository;
    private readonly logger;
    constructor(messageRepository: Repository<Message>);
    onApplicationBootstrap(): Promise<void>;
}
