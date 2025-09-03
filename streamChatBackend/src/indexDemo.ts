import express from 'express';
import { createAgent } from './agents/createAgent';
import { AgentPlatform } from './agents/types'; // Make sure this is imported

const app = express();
// This middleware is crucial to parse JSON request bodies
app.use(express.json()); 

// Define an API endpoint to handle agent creation requests
app.post('/api/create-agent', async (req, res) => {
  try {
    // 1. Extract data from the request body sent by the frontend
    const { agentPlatform, channel_type, channel_id } = req.body;

    // A crucial assumption: How do you get the user_id for the bot?
    // For this example, let's hardcode it, but in a real app, you might have
    // a pool of bot users or a dedicated one per model.
    const bot_user_id = `${agentPlatform}-bot`;

    // 2. --- VALIDATION ---
    // This is a critical security step. Never trust client input directly.
    // We check if the received 'agentPlatform' is a valid, known platform.
    const isValidPlatform = Object.values(AgentPlatform).includes(agentPlatform as AgentPlatform);

    if (!agentPlatform || !channel_type || !channel_id || !isValidPlatform) {
      return res.status(400).json({ error: 'Invalid parameters. Please provide a valid agentPlatform, channel_type, and channel_id.' });
    }
    
    console.log(`Request received to create agent: ${agentPlatform} for channel: ${channel_id}`);

    // 3. --- DYNAMIC AGENT CREATION ---
    // Instead of a hardcoded value, we now use the validated platform from the request.
    const agent = await createAgent(
      bot_user_id,
      agentPlatform as AgentPlatform, // Use the dynamic value here
      channel_type,
      channel_id
    );

    // Initialize the agent after creation
    await agent.init();
    
    // You'd likely store this agent instance in memory, associated with the channel_id,
    // so you can manage its lifecycle (e.g., dispose of it later).
    
    res.status(200).json({ success: true, message: `Agent ${agentPlatform} created for channel ${channel_id}` });

  } catch (error) {
    console.error('Failed to create agent:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
