import { GoogleGenerativeAI, GenerativeModel, Content, Tool, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import type { Channel, DefaultGenerics, Event, StreamChat } from "stream-chat";
import type { AIAgent } from "../types";
import { GeminiResponseHandler } from "./GeminiResponseHandler";

export class GeminiAgent implements AIAgent {
    private genAI?: GoogleGenerativeAI;
    private model?: GenerativeModel;
    // Gemini is stateless, so we must manage the conversation history ourselves.
    private chatHistory: Content[] = [];
    private lastInteractionTs = Date.now();
    private handlers: GeminiResponseHandler[] = [];

    constructor(
        readonly chatClient: StreamChat,
        readonly channel: Channel,
    ) { }

    dispose = async (): Promise<void> => {
        this.chatClient.off("message.new", this.handleMessage);
        await this.chatClient.disconnectUser();

        this.handlers.forEach((handler) => handler.dispose());
        this.handlers = [];
    }

    get user() {
        return this.chatClient.user;
    }

    getLastInteraction = (): number => this.lastInteractionTs;

    init = async (): Promise<void> => {
        const apiKey = process.env.GOOGLE_API_KEY as string | undefined;
        if (!apiKey) {
            throw new Error("Google API key is required");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        const webSearchTool: Tool = {
            functionDeclarations: [
                {
                    name: "web_search",
                    description: "Search the web for current information, news, facts, or research on any topic",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            query: {
                                type: SchemaType.STRING,
                                description: "The search query to find information about",
                            },
                        },
                        required: ["query"],
                    },
                },
            ],
        };
        // Instead of creating a persistent "assistant", we configure a model
        this.model = this.genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            // The system prompt is passed as a systemInstruction
            systemInstruction: this.getWritingAssistantPrompt(),
            tools: [webSearchTool],
            // Temperature is part of generationConfig in Gemini
            generationConfig: {
                temperature: 0.7,
            }
        });
        this.chatClient.on("message.new", this.handleMessage);
    }

    // This prompt is almost identical, as the instructions are model-agnostic.
    private getWritingAssistantPrompt = (context?: string): string => {
        const currentDate = new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
        return `You are an expert AI Writing Assistant. Your primary purpose is to be a collaborative writing partner.

**Your Core Capabilities:**
- Content Creation, Improvement, Style Adaptation, Brainstorming, and Writing Coaching.
- **Web Search**: You have the ability to search the web for up-to-date information using the 'web_search' tool.
- **Current Date**: Today's date is ${currentDate}. Please use this for any time-sensitive queries.

**Crucial Instructions:**
1.  **ALWAYS use the 'web_search' tool when the user asks for current information, news, or facts.** Your internal knowledge is outdated.
2.  When you use the 'web_search' tool, you will receive a JSON object with search results. **You MUST base your response on the information provided in that search result.** Do not rely on your pre-existing knowledge for topics that require current information.
3.  Synthesize the information from the web search to provide a comprehensive and accurate answer. Cite sources if the results include URLs.

**Response Format:**
- Be direct and production-ready.
- Use clear formatting.
- Never begin responses with phrases like "Here's the edit:", "Here are the changes:", or similar introductory statements.
- Provide responses directly and professionally without unnecessary preambles.

**Writing Context**: ${context || "General writing assistance."}

Your goal is to provide accurate, current, and helpful written content. Failure to use web search for recent topics will result in an incorrect answer.`;

    }

    private handleMessage = async (e: Event<DefaultGenerics>) => {
        if (!this.model) {
            console.log("Gemini model not initialized");
            return;
        }
        if (!e.message || e.message.ai_generated) {
            return;
        }
        const message = e.message.text;
        if (!message) return;

        this.lastInteractionTs = Date.now();

        // Add the new user message to our history
        this.chatHistory.push({ role: "user", parts: [{ text: message }] });


        const { message: channelMessage } = await this.channel.sendMessage({
            text: "",
            ai_generated: true,
        });

        await this.channel.sendEvent({
            type: "ai_indicator.update",
            ai_state: "AI_STATE_THINKING",
            cid: channelMessage.cid,
            message_id: channelMessage.id,
        });

        // Start a chat session using our maintained history
        const chat = this.model.startChat({
            history: this.chatHistory,
        });
        // Send the latest message and get a streaming response
        const result = await chat.sendMessageStream(message);

        const handler = new GeminiResponseHandler(
            this.genAI as GoogleGenerativeAI, // 1. Pass the genAI client instance
            result.stream,
            this.chatClient,
            this.channel,
            channelMessage,
            () => this.chatHistory, // 2. Pass a function to GET the full history
            // Pass a callback to append the model's response to our history
            (modelResponse) => this.chatHistory.push(modelResponse), // 3. Pass a function to APPEND to history
            () => this.removeHandler(handler)
        );
        this.handlers.push(handler);
        void handler.run();
    }

    private removeHandler = (handlerToRemove: GeminiResponseHandler) => {
        this.handlers = this.handlers.filter(
            (handler) => handler !== handlerToRemove)
    }
}