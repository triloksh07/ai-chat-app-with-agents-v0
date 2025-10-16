// ... other imports
import { GoogleGenerativeAI, Content, MessageResponse } from "@google/generative-ai";
import { StreamChat } from "stream-chat";

// A simple helper function to wait for a certain amount of time
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export class GeminiResponseHandler {
    // ... (constructor and other properties remain the same)
    
    // --- THIS IS THE MODIFIED METHOD ---
    run = async () => {
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            try {
                // We try to process the stream
                await this.processStream(this.initialStream);
                // If it succeeds, we break the loop
                return; 
            } catch (error: any) {
                // Check if it's a rate limit error (status 429)
                if (error.status === 429 && attempts < maxAttempts - 1) {
                    attempts++;
                    const backoffTime = Math.pow(2, attempts) * 1000; // 2s, 4s, 8s...
                    console.warn(`Rate limit hit. Retrying in ${backoffTime / 1000}s... (Attempt ${attempts}/${maxAttempts})`);
                    await delay(backoffTime);
                    // The loop will continue and try again
                } else {
                    // If it's a different error or we've run out of attempts, handle it and exit.
                    console.error("An error occurred during Gemini stream processing", error);
                    await this.handleError(error);
                    return; // Exit the loop and the function
                }
            }
        }
    }

    // ... (the rest of your file, like processStream, handleError, etc., remains the same)
}

