import { MessageDirection } from '../message/entities/message.entity';
export interface StoredMessageRef {
    chatId: string;
    direction: MessageDirection;
    author?: string | null;
}
export interface MutationSource {
    kind: 'edit' | 'revoke' | 'reaction';
    chatId: string;
    fromMe?: boolean;
    author?: string;
}
export declare function provablyDifferent(a?: string | null, b?: string | null): boolean;
export declare function mutationTargetsForeignRow(row: StoredMessageRef, source: MutationSource): 'chat' | 'direction' | 'author' | null;
