require("dotenv").config();

module.exports = {
  port: parseInt(process.env.PORT || "3001", 10),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  internalApiKey: process.env.INTERNAL_API_KEY || "shared-secret-change-me",
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
  zoomJwtToken: process.env.ZOOM_JWT_TOKEN || "",
  googleMeetHeadless: process.env.GOOGLE_MEET_HEADLESS === "true",
  pythonApiUrl: process.env.PYTHON_API_URL || "http://localhost:8000",
  googleBotName: process.env.GOOGLE_BOT_NAME || "Meeting Assistant",
  googleBotEmail: process.env.GOOGLE_BOT_EMAIL || "",
  googleBotPassword: process.env.GOOGLE_BOT_PASSWORD || "",
};
