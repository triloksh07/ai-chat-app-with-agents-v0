// debug-gemini.js
require('dotenv').config(); // Load environment variables
const { GoogleGenerativeAI } = require("@google/generative-ai");

const AIModel = {
    "m1" : "gemini-2.5-flash",
    "m2":"gemini-2.5-pro",
    "m2":"gemini-2.0-flash-exp",
    "m3":"gemini-2.0-flash",
    "m4":"gemini-2.0-flash-001",
    "m5":"gemini-2.0-flash-exp-image-generation",
    "m6":"gemini-2.0-flash-lite-001",
    "m7":"gemini-2.0-flash-lite",
    "m8":"gemini-2.0-flash-lite-preview-02-05",
    "m9":"gemini-2.0-flash-lite-preview",
    "m10":"gemini-exp-1206",
    "m11":"gemini-2.5-flash-preview-tts",
    "m12":"gemini-2.5-pro-preview-tts",
    "m13":"gemma-3-1b-it",
    "m14":"gemma-3-4b-it",
    "m15":"gemma-3-12b-it",
    "m16":"gemma-3-27b-it",
    "m17":"gemma-3n-e4b-it",
    "m18":"gemma-3n-e2b-it",
    "m19":"gemini-flash-latest",
    "m20":"gemini-flash-lite-latest",
    "m21":"gemini-pro-latest",
    "m22":"gemini-2.5-flash-lite",
    "m23":"gemini-2.5-flash-image-preview",
    "m24":"gemini-2.5-flash-image",
    "m25":"gemini-2.5-flash-preview-09-2025",
    "m26":"gemini-2.5-flash-lite-preview-09-2025",
    "m27":"gemini-3-pro-preview",
    "m28":"gemini-3-pro-image-preview",
    "m29":"nano-banana-pro-preview",
    "m30":"gemini-robotics-er-1.5-preview",
    "m31":"gemini-2.5-computer-use-preview-10-2025",
    "m32":"deep-research-pro-preview-12-2025"
}

async function testConnection() {
  const apiKey = process.env.GEMINI_API_KEY;
  const aiModel = AIModel.m22; 
  // working - m14, m13, m20, m22, m30
  // audio working model - m11, m12 
  // overload - m15, m1

  if (!apiKey) {
    console.error("❌ ERROR: GEMINI_API_KEY is missing in .env file");
    return;
  }

  console.log(`Checking key: ${apiKey.substring(0, 5)}...`);
  console.log(`Attempting to connect with model: ${aiModel} `);
  // console.log("Attempting to connect with model: gemini-2.0-flash");

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const model = genAI.getGenerativeModel({ model: aiModel });

    const result = await model.generateContent("Hello, are you working?");
    const response = await result.response;
    const text = response.text();
    
    console.log("\n✅ SUCCESS! The API is working.");
    console.log("Response:", text);
  } catch (error) {
    console.error("\n❌ FAILED.");
    console.error("Error Message:", error.message);
    
    if (error.message.includes("429")) {
      console.error("Diagnosis: Quota Exceeded (Rate Limit).");
    } else if (error.message.includes("API key not valid")) {
        console.error("Diagnosis: Your API Key is invalid.");
    }
  }
}

testConnection();