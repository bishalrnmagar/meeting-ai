const { chromium } = require("playwright");
const BaseBot = require("./BaseBot");
const audioProcessor = require("../streaming/audioProcessor");
const config = require("../config");

class GoogleMeetBot extends BaseBot {
  constructor(meetingUrl, meetingId) {
    super(meetingUrl, meetingId);
    this.platform = "google_meet";
    this.browser = null;
    this.context = null;
    this.page = null;
    this._mouseMovementInterval = null;
  }

  async join() {
    this.status = "joining";
    console.log(`[GoogleMeetBot] Joining meeting: ${this.meetingUrl}`);

    this.browser = await chromium.launch({
      headless: config.googleMeetHeadless,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      permissions: ["microphone", "camera"],
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });

    this.page = await this.context.newPage();

    // Inject WebRTC audio interceptor BEFORE navigating
    await this._injectAudioInterceptor();

    await this.page.goto(this.meetingUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Start subtle mouse movements to appear human
    this._startMouseMovements();

    await this._waitForMeetReady();

    // Debug screenshot
    await this.page.screenshot({ path: `debug-meet-${this.meetingId}.png`, fullPage: true });
    console.log(`[GoogleMeetBot] Screenshot saved: debug-meet-${this.meetingId}.png`);
    console.log(`[GoogleMeetBot] Page URL: ${this.page.url()}`);
    console.log(`[GoogleMeetBot] Page title: ${await this.page.title()}`);

    await this._checkBlocked();
    await this._dismissDialogs();
    await this._enterGuestName();
    await this._muteMediaBeforeJoin();
    await this._clickJoinButton();
    await this._waitForAdmission();

    this.status = "in_meeting";
    console.log(`[GoogleMeetBot] Successfully joined meeting: ${this.meetingId}`);

    await this._startAudioCapture();
    audioProcessor.startProcessing(this.meetingId, this);

    return true;
  }

  async leave() {
    console.log(`[GoogleMeetBot] Leaving meeting: ${this.meetingId}`);
    this._stopMouseMovements();
    audioProcessor.stopProcessing(this.meetingId);

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
    this.status = "left";
  }

  // --- Pre-join helpers ---

  async _waitForMeetReady() {
    console.log("[GoogleMeetBot] Waiting for meeting page to be ready...");
    const maxWait = 30000;
    const pollInterval = 2000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const bodyText = await this.page.textContent("body");

      if (
        bodyText.includes("You can't join") ||
        bodyText.includes("Check your meeting code") ||
        bodyText.includes("This meeting has ended")
      ) {
        return;
      }

      if (!bodyText.includes("Getting ready")) {
        console.log("[GoogleMeetBot] Meeting page ready");
        return;
      }

      await this.page.waitForTimeout(pollInterval);
    }

    console.log("[GoogleMeetBot] Timed out waiting for 'Getting ready', proceeding...");
  }

  async _checkBlocked() {
    const bodyText = await this.page.textContent("body");

    const blockers = [
      { text: "You can't join this video call", msg: "Meeting blocked: host settings prevent this account from joining." },
      { text: "This meeting has ended", msg: "Meeting has already ended." },
      { text: "Check your meeting code", msg: "Invalid meeting code." },
      { text: "not allowed to join", msg: "This account is not allowed to join the meeting." },
    ];

    for (const { text, msg } of blockers) {
      if (bodyText.includes(text)) {
        const err = new Error(msg);
        err.noRetry = true;
        throw err;
      }
    }
  }

  async _dismissDialogs() {
    const dismissTexts = ["Got it", "Dismiss", "OK", "Accept"];
    for (const text of dismissTexts) {
      try {
        const btn = this.page.getByRole("button", { name: text });
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click();
          console.log(`[GoogleMeetBot] Dismissed dialog: "${text}"`);
          await this.page.waitForTimeout(500);
        }
      } catch {
        // Dialog may not appear
      }
    }
    await this.page.waitForTimeout(1000);
  }

  async _enterGuestName() {
    const botName = config.googleBotName || "Meeting Assistant";
    console.log(`[GoogleMeetBot] Looking for guest name input to enter: "${botName}"`);

    // Playwright's getByPlaceholder is the cleanest approach
    try {
      const nameInput = this.page.getByPlaceholder("Your name");
      if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nameInput.click();
        await nameInput.fill("");
        await nameInput.type(botName, { delay: 50 });
        console.log(`[GoogleMeetBot] Entered guest name: "${botName}"`);
        await this.page.waitForTimeout(500);
        return;
      }
    } catch {
      // Not found via placeholder
    }

    // Fallback: aria-label
    try {
      const nameInput = this.page.getByLabel("Your name");
      if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nameInput.click();
        await nameInput.fill("");
        await nameInput.type(botName, { delay: 50 });
        console.log(`[GoogleMeetBot] Entered guest name via label: "${botName}"`);
        await this.page.waitForTimeout(500);
        return;
      }
    } catch {
      // Not found via label
    }

    // Last resort: any visible text input
    try {
      const inputs = this.page.locator('input[type="text"]:visible, input:not([type]):visible');
      const count = await inputs.count();
      if (count > 0) {
        await inputs.first().fill(botName);
        console.log("[GoogleMeetBot] Entered guest name via fallback input");
        await this.page.waitForTimeout(500);
        return;
      }
    } catch {
      // No input found
    }

    console.log("[GoogleMeetBot] No name input found (may not be in guest mode)");
  }

  async _muteMediaBeforeJoin() {
    // Mute mic
    try {
      const micBtn = this.page.getByRole("button", { name: /turn off microphone/i });
      if (await micBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await micBtn.click();
        console.log("[GoogleMeetBot] Muted microphone");
      }
    } catch {
      // Already muted or not found
    }

    // Mute camera
    try {
      const camBtn = this.page.getByRole("button", { name: /turn off camera/i });
      if (await camBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await camBtn.click();
        console.log("[GoogleMeetBot] Muted camera");
      }
    } catch {
      // Already muted or not found
    }

    await this.page.waitForTimeout(500);
  }

  async _clickJoinButton() {
    // Playwright's text/role locators — try in order of specificity
    const candidates = [
      this.page.getByRole("button", { name: "Ask to join" }),
      this.page.getByRole("button", { name: "Join now" }),
      this.page.getByRole("button", { name: /join/i }),
    ];

    for (const locator of candidates) {
      try {
        if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
          await locator.click();
          const text = await locator.textContent().catch(() => "join");
          console.log(`[GoogleMeetBot] Clicked join button: "${text.trim()}"`);
          await this.page.waitForTimeout(2000);
          return;
        }
      } catch {
        // Try next
      }
    }

    // Debug screenshot before failing
    await this.page.screenshot({ path: `debug-no-join-btn-${this.meetingId}.png`, fullPage: true });
    throw new Error("Could not find any join button — check debug-no-join-btn screenshot");
  }

  async _waitForAdmission() {
    console.log("[GoogleMeetBot] Checking if waiting for host admission...");

    const maxWait = 120000; // 2 minutes
    const pollInterval = 3000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      // Definitive: look for meeting control buttons
      const leaveBtn = this.page.getByRole("button", { name: /leave call|end call/i });
      if (await leaveBtn.isVisible().catch(() => false)) {
        console.log("[GoogleMeetBot] Admitted to the meeting (found call controls)");
        return;
      }

      const bodyText = await this.page.textContent("body");

      // Check if denied or removed
      if (bodyText.includes("removed") || bodyText.includes("denied")) {
        const err = new Error("Host denied the bot's request to join.");
        err.noRetry = true;
        throw err;
      }

      // Still on waiting screen
      if (bodyText.includes("Asking to be let in") || bodyText.includes("waiting")) {
        if ((Date.now() - start) % 15000 < pollInterval) {
          console.log("[GoogleMeetBot] Still waiting for host to admit...");
        }
        await this.page.waitForTimeout(pollInterval);
        continue;
      }

      // Might already be in — check for common meeting text
      if (bodyText.includes("Present now") || bodyText.includes("Leave call")) {
        console.log("[GoogleMeetBot] Admitted to the meeting");
        return;
      }

      await this.page.waitForTimeout(pollInterval);
    }

    const err = new Error("Timed out waiting for host to admit the bot (2 minutes).");
    err.noRetry = true;
    throw err;
  }

  // --- Audio capture via WebRTC interception ---

  async _injectAudioInterceptor() {
    // addInitScript runs BEFORE every page load — equivalent to Puppeteer's evaluateOnNewDocument
    await this.context.addInitScript(() => {
      window.__meetAudioTracks = [];

      const OriginalRTCPeerConnection = window.RTCPeerConnection;

      window.RTCPeerConnection = function (...args) {
        const pc = new OriginalRTCPeerConnection(...args);

        pc.addEventListener("track", (event) => {
          if (event.track.kind === "audio") {
            console.log("[AudioInterceptor] Captured audio track:", event.track.id);
            window.__meetAudioTracks.push(event.track);

            window.dispatchEvent(
              new CustomEvent("__newAudioTrack", {
                detail: { track: event.track, streams: event.streams },
              })
            );
          }
        });

        return pc;
      };

      window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
      Object.keys(OriginalRTCPeerConnection).forEach((key) => {
        window.RTCPeerConnection[key] = OriginalRTCPeerConnection[key];
      });
      window.RTCPeerConnection.generateCertificate =
        OriginalRTCPeerConnection.generateCertificate;
    });
  }

  async _startAudioCapture() {
    // Expose Node callback to the page context
    await this.page.exposeFunction("__onAudioChunk", (samples) => {
      const buffer = Buffer.from(new Int16Array(samples).buffer);
      this.onAudioData(buffer);
    });

    await this.page.evaluate(() => {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const merger = audioContext.createChannelMerger(1);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(data.length);
        for (let i = 0; i < data.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
        }
        window.__onAudioChunk(Array.from(int16));
      };

      merger.connect(processor);
      processor.connect(audioContext.destination);

      function connectTrack(track) {
        try {
          const stream = new MediaStream([track]);
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(merger);
          console.log("[AudioCapture] Connected track:", track.id);
        } catch (err) {
          console.error("[AudioCapture] Failed to connect track:", err);
        }
      }

      (window.__meetAudioTracks || []).forEach(connectTrack);

      window.addEventListener("__newAudioTrack", (e) => {
        connectTrack(e.detail.track);
      });

      window.__audioContext = audioContext;
    });

    console.log("[GoogleMeetBot] Audio capture pipeline started (WebRTC interception)");
  }

  // --- Anti-detection: random mouse movements ---

  _startMouseMovements() {
    this._mouseMovementInterval = setInterval(async () => {
      if (!this.page) return;
      try {
        const x = 200 + Math.random() * 880;
        const y = 150 + Math.random() * 420;
        await this.page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
      } catch {
        // Page may have closed
      }
    }, 15000 + Math.random() * 15000);
  }

  _stopMouseMovements() {
    if (this._mouseMovementInterval) {
      clearInterval(this._mouseMovementInterval);
      this._mouseMovementInterval = null;
    }
  }

  onAudioData(audioBuffer) {
    audioProcessor.processChunk(this.meetingId, audioBuffer);
  }
}

module.exports = GoogleMeetBot;
