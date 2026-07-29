import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  bearerToken: process.env.BEARER_TOKEN || 'default-token',

  // Spec-declared limits (must match actual behavior)
  maxPayloadBytes: 1_048_576,  // 1 MiB
  chunkBytes: 65_536,          // 64 KiB
  maxConcurrentJobs: 4,
  rateLimitPerMinute: 30,

  // LLM provider config
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gemini-3.6-flash',
    baseUrl: process.env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
  },

  // Server start time for uptime calculation
  startTime: Date.now(),
};
