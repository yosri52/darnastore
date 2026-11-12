/**
 * DARNA Mehres Store — AI Call Configuration Endpoint
 * Netlify Function: /api/ai-config
 * Reads Gemini Live API credentials from environment variables (.env)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  const apiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.GEMINI_MODEL || "models/gemini-2.5-flash-native-audio-preview-12-2025";

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      apiKey: apiKey,
      model: model,
      voiceName: "Aoede",
      agentName: "مريم",
      enabled: true
    }),
  };
};
