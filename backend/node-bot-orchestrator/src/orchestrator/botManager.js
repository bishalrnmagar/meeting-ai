const sessionStore = require("./sessionStore");
const ZoomBot = require("../bots/ZoomBot");
const GoogleMeetBot = require("../bots/GoogleMeetBot");
const config = require("../config");

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

function createBot(platform, meetingUrl, meetingId) {
  switch (platform) {
    case "zoom":
      return new ZoomBot(meetingUrl, meetingId);
    case "google_meet":
      return new GoogleMeetBot(meetingUrl, meetingId);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function startBot(meetingId, meetingUrl, platform) {
  if (sessionStore.has(meetingId)) {
    throw new Error(`Bot already running for meeting ${meetingId}`);
  }

  const bot = createBot(platform, meetingUrl, meetingId);
  sessionStore.set(meetingId, bot);

  // Retry logic with exponential backoff
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await bot.join();
      console.log(`[BotManager] ✔ Bot joined | meetingId=${meetingId} | platform=${platform} | attempt=${attempt}`);
      return { meetingId, status: "joined", platform };
    } catch (err) {
      lastError = err;
      console.error(`[BotManager] Join attempt ${attempt} failed for ${meetingId}:`, err.message);
      // Clean up browser so the next attempt can reuse the profile directory
      try { await bot.leave(); } catch { /* ignore cleanup errors */ }
      // Don't retry errors that will never succeed (blocked, ended, invalid code)
      if (err.noRetry) break;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  sessionStore.delete(meetingId);
  throw new Error(`Failed to join after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

async function stopBot(meetingId) {
  const bot = sessionStore.get(meetingId);
  if (!bot) {
    throw new Error(`No bot running for meeting ${meetingId}`);
  }

  await bot.leave();
  sessionStore.delete(meetingId);
  console.log(`[BotManager] Bot left | meetingId=${meetingId} | platform=${bot.platform}`);

  // Notify Python API that meeting ended
  try {
    const resp = await fetch(`${config.pythonApiUrl}/internal/captions/${meetingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "meeting.ended" }),
    });
  } catch (err) {
    console.error("[BotManager] Failed to notify Python API:", err.message);
  }

  return { meetingId, status: "stopped" };
}

function getBotStatus(meetingId) {
  const bot = sessionStore.get(meetingId);
  if (!bot) return null;
  return { meetingId, status: bot.status, platform: bot.platform };
}

module.exports = { startBot, stopBot, getBotStatus };
