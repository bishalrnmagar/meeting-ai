/**
 * One-time setup: opens a browser so you can sign into the bot's Google account.
 * The session is saved to a persistent profile and reused by GoogleMeetBot.
 *
 * Usage: yarn setup-google
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const config = require("./config");

puppeteer.use(StealthPlugin());

const LOGIN_MARKER = path.join(config.googleChromeUserDataDir, ".google-signed-in");

(async () => {
  console.log("[Setup] Launching browser for Google sign-in...");
  console.log(`[Setup] Profile directory: ${config.googleChromeUserDataDir}\n`);
  console.log("Steps:");
  console.log("  1. Sign into the bot's Google account in the browser that opens");
  console.log("  2. Once signed in, visit https://meet.google.com to confirm access");
  console.log("  3. Close the browser window when done\n");

  // Ensure profile directory exists
  fs.mkdirSync(config.googleChromeUserDataDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: config.googleChromeUserDataDir,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const page = await browser.newPage();
  await page.goto("https://accounts.google.com", { waitUntil: "networkidle2" });

  // Wait for the user to close the browser manually
  browser.on("disconnected", () => {
    // Write marker file to indicate sign-in was completed
    fs.writeFileSync(LOGIN_MARKER, new Date().toISOString());
    console.log("\n[Setup] Browser closed. Google session saved.");
    console.log("[Setup] The bot will now use this account to join meetings.");
    console.log("[Setup] You can start the orchestrator with: yarn dev");
    process.exit(0);
  });
})();
