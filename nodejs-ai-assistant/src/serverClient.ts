import { StreamChat } from 'stream-chat';

// 1. Read the variables from the process environment.
//    If they weren't loaded correctly by dotenv, they will be undefined here.
export const apiKey = process.env.STREAM_API_KEY as string;
export const apiSecret = process.env.STREAM_API_SECRET as string;

if (!apiKey || !apiSecret) {
    throw new Error("Missing required environment variables for STREAM_API_KEY and STREAM_API_SECRET")
}

// 2. Initialize the server client with these credentials.
//    This is the client used for all backend operations.
// const serverClient = StreamChat.getInstance(apiKey, apiSecret);
// export { serverClient, apiKey };

export const serverClient = new StreamChat(apiKey, apiSecret)
