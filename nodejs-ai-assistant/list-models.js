// list-models.js
require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listAvailableModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return console.error("No API Key found.");

  const genAI = new GoogleGenerativeAI(apiKey);
  
  console.log("Fetching available models for your API key...");
  try {
    // This lists every model your API key is allowed to see
    const models = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).apiKey; 
    // Wait, we need the model manager, not the model instance for listing
    // Correct way to list models:
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();

    if (data.error) {
        console.error("Error listing models:", data.error.message);
        return;
    }

    console.log("\n✅ AVAILABLE MODELS:");
    const viableModels = data.models
        .filter(m => m.supportedGenerationMethods.includes("generateContent")) // Only chat models
        .map(m => m.name.replace("models/", "")); // Clean up the name

    viableModels.forEach(name => console.log(`- "${name}"`));

    console.log("\nRECOMMENDATION: Pick one of the 'flash' models from above.");
  } catch (error) {
    console.error("Failed to list models:", error.message);
  }
}

listAvailableModels();