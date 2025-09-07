"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const serverClient_1 = require("./serverClient");
const types_1 = require("./agents/types");
const createAgent_1 = require("./agents/createAgent");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)({ origin: "*" })); // Allow requests from any origin // Change this in production for security
// Map to store the AI Agent instances
// [user_id string]: AI Agent
const aiAgentCache = new Map();
const pendingAiAgents = new Set();
// TODO: temporary set to 8 hours, should be cleaned up at some point
const inactivityThreshold = 480 * 60 * 1000;
// Periodically check for inactive AI agents and dispose of them
setInterval(async () => {
    const now = Date.now();
    for (const [userId, aiAgent] of aiAgentCache) {
        if (now - aiAgent.getLastInteraction() > inactivityThreshold) {
            console.log(`Disposing AI Agent due to inactivity: ${userId}`);
            await disposeAiAgent(aiAgent);
            aiAgentCache.delete(userId);
        }
    }
}, 5000);
app.get("/", (req, res) => {
    res.json({
        message: "AI wirting Assistant server is running...",
        apiKey: serverClient_1.apiKey,
        activeAgents: aiAgentCache.size,
    });
});
/**
 * Handle the request to start the AI Agent
 */
app.post("/start-ai-agent", async (req, res) => {
    const { channel_id, channel_type = "messaging" } = req.body;
    console.log(`[API] /start-ai-agent called for channel: ${channel_id}`);
    // Simple validation
    // if (!channel_id) {
    //     res.status(400).json({ error: "Missing required fields" });
    //     return;
    // }
    // --- IMPROVEMENT: Add robust validation ---
    if (!channel_id || typeof channel_id !== 'string') {
        console.error('[API] /start-ai-agent - Bad Request: Missing or invalid channel_id');
        return res.status(400).json({ error: "Missing or invalid 'channel_id' in request body. It must be a non-empty string." });
    }
    const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;
    try {
        // Prevent multiple agents from being created for the same channel simultaneously
        if (!aiAgentCache.has(user_id) && !pendingAiAgents.has(user_id)) {
            console.log(`[API] Creating new agent for ${user_id}`);
            pendingAiAgents.add(user_id);
            await serverClient_1.serverClient.upsertUser({
                id: user_id,
                name: "AI Writing Assistant",
            });
            const channel = serverClient_1.serverClient.channel(channel_type, channel_id);
            // --- THE FIX: Ensure the channel exists before trying to modify it ---
            // If the channel doesn't exist, this will create it. 
            // If it already exists, this does nothing.
            // --- THE FIX: Specify the creator of the channel ---
            // When creating a channel from the server, you must provide a creator's user ID.
            await channel.create({ client_id: user_id });
            // Now it is safe to add members.
            await channel.addMembers([user_id]);
            // await channel.addMembers([user_id]);
            const agent = await (0, createAgent_1.createAgent)(user_id, types_1.AgentPlatform.GEMINI, channel_type, channel_id);
            await agent.init();
            // Final check to prevent race conditions where an agent might have been added
            // while this one was initializing.
            if (aiAgentCache.has(user_id)) {
                await agent.dispose();
            }
            else {
                aiAgentCache.set(user_id, agent);
            }
        }
        else {
            console.log(`AI Agent ${user_id} already started or is pending.`);
        }
        res.json({ message: "AI Agent started", data: [] });
    }
    catch (error) {
        const errorMessage = error.message;
        console.error("Failed to start AI Agent", errorMessage);
        res
            .status(500)
            .json({ error: "Failed to start AI Agent", reason: errorMessage });
    }
    finally {
        pendingAiAgents.delete(user_id);
    }
});
/**
 * Handle the request to stop the AI Agent
 */
app.post("/stop-ai-agent", async (req, res) => {
    // const { channel_id } = req.body;
    const { channel_id, channel_type = "messaging" } = req.body; // Added channel_type
    // --- IMPROVEMENT: Add robust validation ---
    if (!channel_id || typeof channel_id !== 'string') {
        console.error('[API] /stop-ai-agent - Bad Request: Missing or invalid channel_id');
        return res.status(400).json({ error: "Missing or invalid 'channel_id' in request body. It must be a non-empty string." });
    }
    console.log(`[API] /stop-ai-agent called for channel: ${channel_id}`);
    const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;
    try {
        const aiAgent = aiAgentCache.get(user_id);
        if (aiAgent) {
            console.log(`[API] Disposing agent for ${user_id}`);
            await disposeAiAgent(aiAgent);
            aiAgentCache.delete(user_id);
        }
        else {
            console.log(`[API] Agent for ${user_id} not found in cache.`);
        }
        res.json({ message: "AI Agent stopped", data: [] });
    }
    catch (error) {
        const errorMessage = error.message;
        console.error("Failed to stop AI Agent", errorMessage);
        res
            .status(500)
            .json({ error: "Failed to stop AI Agent", reason: errorMessage });
    }
});
app.get("/agent-status", (req, res) => {
    const { channel_id } = req.query;
    if (!channel_id || typeof channel_id !== "string") {
        console.error('[API] /agent-status - Bad Request: Missing or invalid channel_id');
        return res.status(400).json({ error: "Missing channel_id" });
    }
    const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;
    console.log(`[API] /agent-status called for channel: ${channel_id} (user: ${user_id})`);
    if (aiAgentCache.has(user_id)) {
        console.log(`[API] Status for ${user_id}: connected`);
        res.json({ status: "connected" });
    }
    else if (pendingAiAgents.has(user_id)) {
        console.log(`[API] Status for ${user_id}: connecting`);
        res.json({ status: "connecting" });
    }
    else {
        console.log(`[API] Status for ${user_id}: disconnected`);
        res.json({ status: "disconnected" });
    }
});
// Token provider endpoint - generates secure tokens
app.post("/token", async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            console.error('[API] /token - Bad Request: Missing or invalid userId');
            return res.status(400).json({
                error: "userId is required",
            });
        }
        // Create token with expiration (1 hour) and issued at time for security
        const issuedAt = Math.floor(Date.now() / 1000);
        const expiration = issuedAt + 60 * 60; // 1 hour from now
        const token = serverClient_1.serverClient.createToken(userId, expiration, issuedAt);
        res.json({ token });
    }
    catch (error) {
        console.error("Error generating token:", error);
        res.status(500).json({
            error: "Failed to generate token",
        });
    }
});
async function disposeAiAgent(aiAgent) {
    await aiAgent.dispose();
    if (!aiAgent.user) {
        return;
    }
    await serverClient_1.serverClient.deleteUser(aiAgent.user.id, {
        hard_delete: true,
    });
}
// Start the Express server
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
//# sourceMappingURL=index.js.map