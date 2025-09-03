import type {Channel, StreamChat, User} from 'stream-chat';

export interface AIAgent {
    user?: User;
    channel: Channel;
    chatClient: StreamChat;
    getLastInteraction: () => number;
    // setLastInteraction: (date: Date) => void;
    init: () => Promise<void>;
    dispose: () => Promise<void>;
}

export enum AgentPlatform {
    OPENAI = "openai",
    WRITING_ASSISTANT = "writing_assistant",
}

export interface WritingMessage {
    custom?: {
        suggestions?: string[];
        writingTask?: string;
        messageType?: 'user_input' | 'ai_response' | 'system';
    }
}
