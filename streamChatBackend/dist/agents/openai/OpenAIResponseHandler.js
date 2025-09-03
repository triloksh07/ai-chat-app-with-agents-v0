"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIResponseHandler = void 0;
class OpenAIResponseHandler {
    constructor(openai, openAiThread, assistantStream, chatClient, channel, message, onDispose) {
        this.openai = openai;
        this.openAiThread = openAiThread;
        this.assistantStream = assistantStream;
        this.chatClient = chatClient;
        this.channel = channel;
        this.message = message;
        this.onDispose = onDispose;
        this.message_text = '';
        this.chunk_counter = 0;
        this.run_id = "";
        this.is_done = false;
        this.last_update_time = 0;
        this.run = async () => { };
        this.dispose = async () => {
            if (this.is_done) {
                return;
            }
            this.is_done = true;
            this.chatClient.off('ai_indicator.stop', this.handleStopGenerating);
            this.onDispose();
        };
        this.handleStopGenerating = async (event) => {
            if (this.is_done || event.message_id !== this.message.id) {
                return;
            }
            if (event.cid !== this.channel.cid) {
                return;
            }
            console.log("Stop generating for message: ", this.message.id);
            if (!this.openai || !this.openAiThread || !this.run_id) {
                return;
            }
            try {
                await this.openai.beta.threads.runs.cancel(this.run_id, { thread_id: this.openAiThread.id });
            }
            catch (e) {
                console.error('Error cancelling run', e);
                await this.channel.sendEvent({
                    type: 'ai_indicator.update',
                    ai_state: 'AI_STATE_CANCELLED',
                    cid: this.message.cid,
                    message_id: this.message.id,
                });
                await this.dispose();
            }
            // await this.chatClient.partialUpdateMessage(this.message.id, {
            //     set: {
            //         text: this.message_text + "\n\n*Response generation cancelled.*",
            //         metadata: {
            //             ...this.message.metadata,
            //             openai_run_id: this.run_id,
            //             chunk_counter: this.chunk_counter,
            //             is_streaming: false,
            //             is_cancelled: true,
            //         }
            //     }
            // });
            // await this.dispose();
        };
        this.handleStreamEvent = async (event) => { };
        this.handelError = async (error) => {
            if (this.is_done) {
                return;
            }
            ;
            await this.channel.sendEvent({
                type: 'ai_indicator.update',
                ai_state: 'AI_STATE_ERROR',
                cid: this.channel.cid,
                message_id: this.message.id,
            });
            await this.chatClient.partialUpdateMessage(this.message.id, {
                set: {
                    text: error.message ?? "Error generating the message",
                    message: error.toString(),
                }
            });
            await this.dispose();
            console.error("Error in OpenAIResponseHandler:", error);
        };
        this.performWebSearch = async (query) => {
            const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
            if (!TAVILY_API_KEY) {
                // throw new Error("TAVILY_API_KEY is not set");
                return JSON.stringify({ error: "web search is not available, API key not configured" });
            }
            console.log(`Performing web search for ${query}`);
            try {
                const response = await fetch("https://api.tavily.com/search", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${TAVILY_API_KEY}`,
                    },
                    body: JSON.stringify({
                        query: query,
                        search_depth: "advanced",
                        max_results: 3,
                        include_answer: true,
                        include_raw_content: false,
                    }),
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Tavily search failed for query "${query}":`, errorText);
                    return JSON.stringify({
                        error: `Search failed with status: ${response.status}`,
                        details: errorText,
                    });
                }
                const data = await response.json();
                console.log(`Tavily search successful for query "${query}"`);
                return JSON.stringify(data);
            }
            catch (error) {
                console.error(`An exception occured during web search for ${query}`);
                return JSON.stringify({
                    error: 'An exception occured during web search'
                });
            }
        };
        this.chatClient.on('ai_indicator.stop', this.handleStopGenerating);
    }
}
exports.OpenAIResponseHandler = OpenAIResponseHandler;
// constructor(
//     private readonly openai: OpenAI,
//     private chat_client: StreamChat,
//     private channel: Channel,
//     private user_id: string,
//     private message_id: string,
//     private on_done: (messageResponse: MessageResponse) => void,
//     private on_error: (error: Error) => void,
//     private update_interval: number = 2000, // milliseconds
// ) { }
//     public async handleResponse(stream: AssistantStream) {
//     try {
//         for await (const chunk of stream) {
//             this.processChunk(chunk);
//         }
//         this.finalizeMessage();
//     } catch (error) {
//         this.on_error(error as Error);
//     }
// }
//     private processChunk(chunk: any) {
//     if (this.is_done) return;
//     if (chunk.id && !this.run_id) {
//         this.run_id = chunk.id;
//     }
//     if (chunk.choices && chunk.choices.length > 0) {
//         const delta = chunk.choices[0].delta;
//         if (delta && delta.content) {
//             this.message_text += delta.content;
//             this.chunk_counter++;
//             const now = Date.now();
//             if (now - this.last_update_time > this.update_interval) {
//                 this.updateMessage();
//                 this.last_update_time = now;
//             }
//         }
//         if (chunk.choices[0].finish_reason) {
//             this.is_done = true;
//         }
//     }
// }
//     private async updateMessage() {
//     try {
//         await this.chat_client.updateMessage({
//             id: this.message_id,
//             text: this.message_text,
//             user_id: this.user_id,
//             metadata: {
//                 openai_run_id: this.run_id,
//                 chunk_counter: this.chunk_counter,
//                 is_streaming: true,
//             },
//         });
//     } catch (error) {
//         console.error('Failed to update message:', error);
//     }
// }
//     private async finalizeMessage() {
//     try {
//         const response = await this.chat_client.updateMessage({
//             id: this.message_id,
//             text: this.message_text,
//             user_id: this.user_id,
//             metadata: {
//                 openai_run_id: this.run_id,
//                 chunk_counter: this.chunk_counter,
//                 is_streaming: false,
//             },
//         });
//         this.on_done(response);
//     } catch (error) {
//         this.on_error(error as Error);
//     }
// }
//# sourceMappingURL=OpenAIResponseHandler.js.map