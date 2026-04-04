const express = require("express");
const config = require("../config");
const botManager = require("../orchestrator/botManager");
const sessionStore = require("../orchestrator/sessionStore");

const router = express.Router();

// Auth middleware for internal API
function authMiddleware(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== config.internalApiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.use(authMiddleware);

// Start a bot for a meeting
router.post("/bots/start", async (req, res) => {
  const { meeting_id, meeting_url, platform } = req.body;

  if (!meeting_id || !meeting_url || !platform) {
    return res.status(400).json({ error: "Missing required fields: meeting_id, meeting_url, platform" });
  }

  try {
    const result = await botManager.startBot(meeting_id, meeting_url, platform);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop a bot
router.post("/bots/stop", async (req, res) => {
  const { meeting_id } = req.body;

  if (!meeting_id) {
    return res.status(400).json({ error: "Missing meeting_id" });
  }

  try {
    const result = await botManager.stopBot(meeting_id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Get bot status
router.get("/bots/:meetingId/status", (req, res) => {
  const status = botManager.getBotStatus(req.params.meetingId);
  if (!status) {
    return res.status(404).json({ error: "No bot found for this meeting" });
  }
  res.json(status);
});

// List all active bots
router.get("/bots", (req, res) => {
  const sessions = sessionStore.getAll();
  const bots = Object.entries(sessions).map(([id, bot]) => ({
    meetingId: id,
    status: bot.status,
    platform: bot.platform,
  }));
  res.json({ active_bots: bots, count: bots.length });
});

module.exports = router;
