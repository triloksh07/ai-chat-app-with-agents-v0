import cors from "cors";
import "dotenv/config";
import express from "express";
import { createAgent } from "./agents/createAgent";
import { AgentPlatform, AIAgent } from "./agents/types";
import { apiKey, serverClient } from "./serverClient";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

// ... (rest of your existing code: aiAgentCache, pendingAiAgents)
const aiAgentCache = new Map<string, AIAgent>();
const pendingAiAgents = new Set<string>();
const inactivityThreshold = 480 * 60 * 1000;

// The cleanup interval now does a "hard" delete.
setInterval(async () => {
    const now = Date.now();
    for (const [userId, aiAgent] of aiAgentCache) {
        if (now - aiAgent.getLastInteraction() > inactivityThreshold) {
            console.log(`Disposing AI Agent due to inactivity: ${userId}`);
            // The 'true' flag indicates a hard delete.
            await disposeAiAgent(aiAgent, { hardDelete: true });
            aiAgentCache.delete(userId);
        }
    }
}, 5000);

app.get("/", (req, res) => {
    res.json({
        message: "AI Writing Assistant Server is running",
        apiKey: apiKey,
        activeAgents: aiAgentCache.size,
    });
});

/**
 * Handle the request to start the AI Agent
 */
app.post("/start-ai-agent", async (req, res) => {
    const { channel_id, channel_type = "messaging" } = req.body;

    if (!channel_id || typeof channel_id !== 'string') {
        console.error('[API] /start-ai-agent - Bad Request: Missing or invalid channel_id');
        return res.status(400).json({ error: "Missing or invalid 'channel_id' in request body. It must be a non-empty string." });
    }

    console.log(`[API] /start-ai-agent called for channel: ${channel_id}`);

    const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;

    try {
        if (!aiAgentCache.has(user_id) && !pendingAiAgents.has(user_id)) {
            console.log(`[API] Creating new agent for ${user_id}`);
            pendingAiAgents.add(user_id);

            await serverClient.upsertUser({
                id: user_id,
                name: "AI Writing Assistant",
            });

            const channel = serverClient.channel(channel_type, channel_id);

            await channel.create({ client_id: user_id });

            await channel.addMembers([user_id]);

            const agent = await createAgent(
                user_id,
                AgentPlatform.OPENAI,
                channel_type,
                channel_id
            );

            await agent.init();

            if (aiAgentCache.has(user_id)) {
                await agent.dispose();
            } else {
                aiAgentCache.set(user_id, agent);
            }
        } else {
            console.log(`AI Agent ${user_id} already started or is pending.`);
        }

        res.json({ message: "AI Agent started" });
    } catch (error) {
        const errorMessage = (error as Error).message;
        console.error("Failed to start AI Agent", errorMessage);
        res
            .status(500)
            .json({ error: "Failed to start AI Agent", reason: errorMessage });
    } finally {
        pendingAiAgents.delete(user_id);
    }
});

/**
 * Handle the request to stop the AI Agent
 * This is now a "soft stop" - the bot leaves the channel but the user account remains.
 */
app.post("/stop-ai-agent", async (req, res) => {
    const { channel_id, channel_type = "messaging" } = req.body; // Added channel_type
    if (!channel_id || typeof channel_id !== 'string') {
        console.error('[API] /stop-ai-agent - Bad Request: Missing or invalid channel_id');
        return res.status(400).json({ error: "Missing or invalid 'channel_id' in request body. It must be a non-empty string." });
    }
    console.log(`[API] /stop-ai-agent called for channel: ${channel_id}`);
    const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;
    try {
        const aiAgent = aiAgentCache.get(user_id);
        if (aiAgent) {
            console.log(`[API] Disposing agent for ${user_id} (soft stop)`);
            // The 'false' flag indicates a soft stop.
            await disposeAiAgent(aiAgent, { hardDelete: false, channel_type, channel_id });
            aiAgentCache.delete(user_id);
        } else {
            console.log(`[API] Agent for ${user_id} not found in cache.`);
        }
        res.json({ message: "AI Agent stopped" });
    } catch (error) {
        const errorMessage = (error as Error).message;
        console.error("Failed to stop AI Agent", errorMessage);
        res.status(500).json({ error: "Failed to stop AI Agent", reason: errorMessage });
    }
});

// ... (rest of your file: /agent-status, /token)
app.get("/agent-status", (req, res) => {
    const { channel_id } = req.query;
    if (!channel_id || typeof channel_id !== "string") {
        return res.status(400).json({ error: "Missing channel_id" });
    }
    const user_id = `ai-bot-${channel_id.replace(/[!]/g, "")}`;
    console.log(`[API] /agent-status called for channel: ${channel_id} (user: ${user_id})`);
    if (aiAgentCache.has(user_id)) {
        console.log(`[API] Status for ${user_id}: connected`);
        res.json({ status: "connected" });
    } else if (pendingAiAgents.has(user_id)) {
        console.log(`[API] Status for ${user_id}: connecting`);
        res.json({ status: "connecting" });
    } else {
        console.log(`[API] Status for ${user_id}: disconnected`);
        res.json({ status: "disconnected" });
    }
});

app.post("/token", async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }
        const issuedAt = Math.floor(Date.now() / 1000);
        const expiration = issuedAt + 60 * 60;
        const token = serverClient.createToken(userId, expiration, issuedAt);
        res.json({ token });
    } catch (error) {
        console.error("Error generating token:", error);
        res.status(500).json({ error: "Failed to generate token" });
    }
});


/**
 * Disposes of an AI agent with options for soft or hard deletion.
 * @param aiAgent The agent instance to dispose.
 * @param options Control the disposal behavior.
 */
async function disposeAiAgent(aiAgent: AIAgent, options: { hardDelete: boolean, channel_id?: string, channel_type?: string }) {
    await aiAgent.dispose();
    const user = aiAgent.user;
    if (!user) {
        return;
    }

    if (options.hardDelete) {
        console.log(`Hard deleting user ${user.id}`);
        await serverClient.deleteUser(user.id, {
            hard_delete: true,
        });
    } else if (options.channel_id && options.channel_type) {
        console.log(`Removing user ${user.id} from channel ${options.channel_id}`);
        const channel = serverClient.channel(options.channel_type, options.channel_id);
        await channel.removeMembers([user.id]);
    }
}


const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

