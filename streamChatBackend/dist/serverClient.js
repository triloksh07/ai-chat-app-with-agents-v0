"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverClient = exports.apiSecret = exports.apiKey = void 0;
const stream_chat_1 = require("stream-chat");
// 1. Read the variables from the process environment.
//    If they weren't loaded correctly by dotenv, they will be undefined here.
exports.apiKey = process.env.STREAM_API_KEY;
exports.apiSecret = process.env.STREAM_API_SECRET;
if (!exports.apiKey || !exports.apiSecret) {
    throw new Error("Missing required environment variables for STREAM_API_KEY and STREAM_API_SECRET");
}
// 2. Initialize the server client with these credentials.
//    This is the client used for all backend operations.
// const serverClient = StreamChat.getInstance(apiKey, apiSecret);
// export { serverClient, apiKey };
exports.serverClient = new stream_chat_1.StreamChat(exports.apiKey, exports.apiSecret);
//# sourceMappingURL=serverClient.js.map