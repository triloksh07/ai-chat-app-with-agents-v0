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
        this.run = async () => {
            const { cid, id: message_id } = this.message;
            let isCompleted = false;
            let toolOutputs = [];
            let currentStream = this.assistantStream;
            try {
                while (!isCompleted) {
                    for await (const event of currentStream) {
                        this.handleStreamEvent(event);
                        if (event.event === "thread.run.requires_action" &&
                            event.data.required_action?.type === "submit_tool_outputs") {
                            this.run_id = event.data.id;
                            await this.channel.sendEvent({
                                type: "ai_indicator.update",
                                ai_state: "AI_STATE_EXTERNAL_SOURCES",
                                cid: cid,
                                message_id: message_id,
                            });
                            const toolCalls = event.data.required_action.submit_tool_outputs.tool_calls;
                            toolOutputs = [];
                            for (const toolCall of toolCalls) {
                                if (toolCall.function.name === "web_search") {
                                    try {
                                        const args = JSON.parse(toolCall.function.arguments);
                                        const searchResult = await this.performWebSearch(args.query);
                                        toolOutputs.push({
                                            tool_calls_id: toolCall.id,
                                            output: searchResult,
                                        });
                                    }
                                    catch (e) {
                                        console.error("Error performing web search:", e);
                                        toolOutputs.push({
                                            tool_call_id: toolCall.id,
                                            output: JSON.stringify({ error: "failed to call tool" }),
                                        });
                                    }
                                }
                            }
                            break; // exit the for-await loop to submit tool outputs
                        }
                        if (event.event === "thread.run.completed") {
                            isCompleted = true;
                            break;
                        }
                        if (event.event === "thread.run.failed") {
                            isCompleted = true;
                            await this.handelError(new Error(event.data.last_error?.message ?? "Run failed"));
                            break; // Exit the inner loop
                        }
                    }
                    if (isCompleted) {
                        break; // exit the while loop
                    }
                    if (toolOutputs.length > 0) {
                        currentStream = this.openai.beta.threads.runs.submitToolOutputsStream(this.run_id, { thread_id: this.openAiThread.id, tool_outputs: toolOutputs });
                        toolOutputs = []; // Reset tool outputs
                    }
                }
            }
            catch (error) {
                // Handle any errors that occur during streaming
                // this.handelError(new Error("Error during OpenAI stream processing"));
                console.error("An error occured during OpenAI stream processing", error);
                await this.handelError(error);
            }
            finally {
                await this.dispose();
            }
        };
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
            // we'll work on this later
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
        this.handleStreamEvent = async (event) => {
            const { cid, id } = this.message;
            if (event.event === "thread.run.created") {
                this.run_id = event.data.id;
            }
            else if (event.event === "thread.message.delta") {
                const textDelta = event.data.delta.content?.[0];
                if (textDelta?.type === "text" && textDelta.text) {
                    this.message.text += textDelta.text.value || "";
                    const now = Date.now();
                    if (now - this.last_update_time > 1000) {
                        // make it await if required
                        this.chatClient.partialUpdateMessage(id, {
                            set: { text: this.message_text }
                        });
                        this.last_update_time = now;
                    }
                    this.chunk_counter += 1;
                }
            }
            else if (event.event === "thread.message.completed") {
                this.chatClient.partialUpdateMessage(id, {
                    set: {
                        text: event.data.content[0].type === "text"
                            ? event.data.content[0].text.value
                            : this.message_text,
                    }
                });
                this.channel.sendEvent({
                    type: "ai_indicator.clear",
                    cid: cid,
                    message_id: id,
                });
            }
            else if (event.event === "thread.run.step.created") {
                if (event.data.step_details.type === "message_creation") {
                    this.channel.sendEvent({
                        type: "ai_indicator.update",
                        ai_state: "AI_STATE_GENERATING",
                        cid: cid,
                        message_id: id,
                    });
                }
            }
        };
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