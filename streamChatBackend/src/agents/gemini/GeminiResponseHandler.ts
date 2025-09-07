import type { StreamChat, Channel, Message, Event, MessageResponse } from "stream-chat";
import type { Content, EnhancedGenerateContentResponse, GoogleGenerativeAI, Part } from "@google/generative-ai";

export class GeminiResponseHandler {
    private message_text = '';
    private is_done = false;
    private last_update_time = 0;

    constructor(
        // The Gemini model is needed to make follow-up calls after tool execution
        private readonly genAI: GoogleGenerativeAI,
        private readonly stream: AsyncGenerator<EnhancedGenerateContentResponse>,
        private readonly chatClient: StreamChat,
        private readonly channel: Channel,
        private readonly message: MessageResponse,
        // Callback to GET the agent's full, up-to-date chat history
        private readonly getChatHistory: () => Content[],
        // Callback to update the agent's central chat history
        private readonly appendToHistory: (content: Content) => void,
        private readonly onDone: () => void,
    ) {
        // We can listen for a stop event, but Gemini doesn't have a run to "cancel".
        // The best we can do is stop processing.
        this.chatClient.on('ai_indicator.stop', this.handleStopGenerating);
    }

    public async run() {
        try {
            // Process the initial stream from the agent
            await this.processStream(this.stream);
        } catch (error) {
            console.error("An error occurred during Gemini stream processing", error);
            await this.handleError(error as Error);
        } finally {
            // This is called when the run is complete or an error occurred
            await this.dispose();
        }
    }

    private async processStream(stream: AsyncGenerator<EnhancedGenerateContentResponse>) {
        const { cid, id: message_id } = this.message;
        let functionCall: { name: string; args: any; } | null = null;

        // 1. Iterate through the stream from the API
        for await (const chunk of stream) {
            // Check for a function call first
            const fc = chunk.functionCalls()?.[0];
            if (fc) {
                functionCall = { name: fc.name, args: fc.args };
                // A function call means this stream is done; we need to execute the tool.
                break;
            }

            // If not a function call, it's a text chunk
            const textPart = chunk.text();
            if (textPart) {
                this.message_text += textPart;
                const now = Date.now();
                // Throttle UI updates to once per second to avoid flooding the API
                if (now - this.last_update_time > 1000) {
                    await this.chatClient.partialUpdateMessage(message_id, {
                        set: { text: this.message_text }
                    });
                    this.last_update_time = now;
                }
            }
        }

        // 2. After the loop, check if a tool needs to be called
        if (functionCall) {
            // Add the model's request to use a tool to our history
            this.appendToHistory({
                role: 'model',
                parts: [{ functionCall: { name: functionCall.name, args: functionCall.args } }]
            });

            await this.channel.sendEvent({
                type: "ai_indicator.update",
                ai_state: "AI_STATE_EXTERNAL_SOURCES",
                cid: cid,
                message_id: message_id,
            });

            let toolOutput: Part;
            if (functionCall.name === 'web_search') {
                const searchResult = await this.performWebSearch(functionCall.args.query);
                toolOutput = {
                    functionResponse: {
                        name: 'web_search',
                        response: { result: searchResult },
                    },
                };
            } else {
                toolOutput = {
                    functionResponse: {
                        name: functionCall.name,
                        response: { error: `Unknown function call: ${functionCall.name}` },
                    },
                };
            }

            // Add the tool's output to our history
            this.appendToHistory({ role: 'function', parts: [toolOutput] });

            // 3. Send the tool output back to the model to get a final response
            // We need to get the full history from the agent to do this.
            // NOTE: This requires a way to access the agent's history or passing it in.
            // For now, let's assume we can get it from the model instance passed to the constructor.
            const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

            // Start a new chat with the updated history including the tool output
            // If we tried to reuse the existing stream, it would be done.
            // const result = await model.generateContentStream([
            //     // This is a simplified history. In a real app, you'd get the full history from GeminiAgent.
            //     { role: 'user', parts: [{ text: "..." }] }, // This part needs to be improved
            //     { role: 'model', parts: [{ functionCall: { name: functionCall.name, args: functionCall.args } }] },
            //     { role: 'function', parts: [toolOutput] }
            // ]);

            // Get the complete, updated history from the agent before making the next call
            const updatedHistory = this.getChatHistory();
            const result = await model.generateContentStream({contents: updatedHistory});

            // Process the *second* stream which contains the final text answer
            await this.processStream(result.stream);

        } else {
            // If there was no function call, the stream finished with text. Finalize the message.
            await this.chatClient.partialUpdateMessage(message_id, {
                set: { text: this.message_text }
            });
            await this.channel.sendEvent({
                type: "ai_indicator.clear",
                cid: cid,
                message_id: message_id,
            });
            // Add the final model response to history
            this.appendToHistory({ role: 'model', parts: [{ text: this.message_text }] });
        }
    }

    public dispose = async () => {
        if (this.is_done) { return; }
        this.is_done = true;
        this.chatClient.off('ai_indicator.stop', this.handleStopGenerating);
        this.onDone();
    };

    private handleStopGenerating = async (event: Event) => {
        if (this.is_done || event.message_id !== this.message.id) { return; }
        // Stop processing, update message and dispose
        await this.chatClient.partialUpdateMessage(this.message.id, {
            set: { text: this.message_text + "\n\n*Response generation stopped.*" }
        });
        await this.dispose();
    }

    private handleError = async (error: Error) => {
        if (this.is_done) { return; }
        await this.channel.sendEvent({
            type: 'ai_indicator.update',
            ai_state: 'AI_STATE_ERROR',
            cid: this.channel.cid,
            message_id: this.message.id,
        });
        await this.chatClient.partialUpdateMessage(this.message.id, {
            set: { text: `**Error:** ${error.message || "An unknown error occurred."}` }
        });
        console.error("Error in GeminiResponseHandler:", error);
    };

    // This method can be copied directly from OpenAIResponseHandler as it's provider-agnostic.
    private performWebSearch = async (query: string): Promise<string> => {
        const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

        if (!TAVILY_API_KEY) {
            return JSON.stringify({ error: "web search is not available, API key not configured" });
        }

        console.log(`Performing web search for ${query}`);

        try {
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    api_key: TAVILY_API_KEY,
                    query: query,
                    search_depth: "advanced",
                    max_results: 3,
                    include_answer: true,
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                return JSON.stringify({ error: `Search failed with status: ${response.status}`, details: errorText });
            }
            const data = await response.json();
            return JSON.stringify(data);
        } catch (error) {
            return JSON.stringify({ error: 'An exception occurred during web search' });
        }
    };
}

