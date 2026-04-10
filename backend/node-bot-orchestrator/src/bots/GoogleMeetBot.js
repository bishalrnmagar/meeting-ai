const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const BaseBot = require("./BaseBot");
const audioProcessor = require("../streaming/audioProcessor");
const config = require("../config");

puppeteer.use(StealthPlugin());

class GoogleMeetBot extends BaseBot {
  constructor(meetingUrl, meetingId) {
    super(meetingUrl, meetingId);
    this.platform = "google_meet";
    this.browser = null;
    this.page = null;
    this._mouseMovementInterval = null;
    this._meetingEndCallback = null;
  }

  onMeetingEnd(callback) {
    this._meetingEndCallback = callback;
  }

  async join() {
    this.status = "joining";
    console.log(`[GoogleMeetBot] Joining meeting: ${this.meetingUrl}`);

    const userDataDir = path.join(__dirname, "..", "..", "chrome-profile");

    this.browser = await puppeteer.launch({
      headless: false,
      channel: "chrome",
      userDataDir,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,720",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      defaultViewport: { width: 1280, height: 720 },
    });

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());

    // Grant mic/camera permissions for Google Meet
    const context = this.browser.defaultBrowserContext();
    await context.overridePermissions("https://meet.google.com", [
      "microphone",
      "camera",
      "notifications",
    ]);

    // Inject WebRTC interceptor via evaluateOnNewDocument (runs on next navigation)
    await this._injectAudioInterceptor();

    await this.page.goto(this.meetingUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Also inject directly in case evaluateOnNewDocument didn't fire
    await this._injectAudioInterceptorDirect();

    // Start subtle mouse movements to appear human
    this._startMouseMovements();

    await this._waitForMeetReady();

    // Debug screenshot
    await this.page.screenshot({
      path: `debug-screenshots/debug-meet-${this.meetingId}.png`,
      fullPage: true,
    });
    console.log(
      `[GoogleMeetBot] Screenshot saved: debug-meet-${this.meetingId}.png`
    );
    console.log(`[GoogleMeetBot] Page URL: ${this.page.url()}`);
    console.log(
      `[GoogleMeetBot] Page title: ${await this.page.title()}`
    );

    await this._checkBlocked();
    await this._dismissDialogs();
    await this._enterGuestName();
    await this._muteMediaBeforeJoin();
    await this._clickJoinButton();
    // Re-check for blocks after clicking join
    await this._sleep(2000);
    await this._checkBlocked();
    await this._waitForAdmission();

    this.status = "in_meeting";
    console.log(
      `[GoogleMeetBot] Successfully joined meeting: ${this.meetingId}`
    );

    await this._startAudioCapture();
    audioProcessor.startProcessing(this.meetingId, this);

    // Monitor for meeting end in the background
    this._monitorMeetingEnd();

    return true;
  }

  async leave() {
    console.log(`[GoogleMeetBot] Leaving meeting: ${this.meetingId}`);
    this._stopMouseMovements();
    audioProcessor.stopProcessing(this.meetingId);

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
    this.status = "left";
  }

  // --- Helpers ---

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async _findButtonByText(textOrTexts) {
    const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
    return await this.page.evaluateHandle((texts) => {
      const buttons = Array.from(document.querySelectorAll("button"));
      for (const text of texts) {
        const btn = buttons.find((b) => b.innerText.trim().toLowerCase().includes(text.toLowerCase()));
        if (btn) return btn;
      }
      return null;
    }, texts);
  }

  async _waitForMeetReady() {
    console.log("[GoogleMeetBot] Waiting for meeting page to be ready...");
    const maxWait = 30000;
    const pollInterval = 2000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const bodyText = await this.page.evaluate(
        () => document.body.innerText
      );

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

      await this._sleep(pollInterval);
    }

    console.log(
      "[GoogleMeetBot] Timed out waiting for 'Getting ready', proceeding..."
    );
  }

  async _checkBlocked() {
    const bodyText = await this.page.evaluate(
      () => document.body.innerText
    );

    const blockers = [
      {
        text: "You can't join this video call",
        msg: "Meeting blocked: host settings prevent this account from joining.",
      },
      {
        text: "This meeting has ended",
        msg: "Meeting has already ended.",
      },
      {
        text: "Check your meeting code",
        msg: "Invalid meeting code.",
      },
      {
        text: "not allowed to join",
        msg: "This account is not allowed to join the meeting.",
      },
    ];

    for (const { text, msg } of blockers) {
      if (bodyText.includes(text)) {
        // Check if we're actually on the block page vs the pre-join lobby
        // The pre-join lobby has a name input or join button — if those exist, we're NOT blocked
        const hasNameInput = await this.page.$('input[placeholder="Your name"], input[aria-label="Your name"]');
        const hasJoinBtn = await this._findButtonByText(["Join now", "Ask to join"]);
        const joinBtnExists = hasJoinBtn && await hasJoinBtn.asElement();
        if (hasNameInput || joinBtnExists) {
          console.log(`[GoogleMeetBot] _checkBlocked: found "${text}" in body but pre-join elements exist — not actually blocked`);
          return;
        }

        console.log(`[GoogleMeetBot] _checkBlocked: BLOCKED — "${text}"`);
        await this.page.screenshot({ path: `debug-screenshots/debug-blocked-${this.meetingId}.png`, fullPage: true });
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
        const handle = await this._findButtonByText(text);
        const btn = handle ? handle.asElement() : null;
        if (btn) {
          const visible = await btn.boundingBox();
          if (visible) {
            await btn.click();
            console.log(`[GoogleMeetBot] Dismissed dialog: "${text}"`);
            await this._sleep(500);
          }
        }
      } catch {
        // Dialog may not appear
      }
    }
    await this._sleep(1000);
  }

  async _enterGuestName() {
    const botName = config.googleBotName || "Meeting Assistant";
    console.log(
      `[GoogleMeetBot] Looking for guest name input to enter: "${botName}"`
    );

    // Try finding input by placeholder "Your name"
    try {
      const nameInput = await this.page.waitForSelector(
        'input[placeholder="Your name"]',
        { timeout: 3000, visible: true }
      );
      if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(botName, { delay: 50 });
        console.log(`[GoogleMeetBot] Entered guest name: "${botName}"`);
        await this._sleep(500);
        return;
      }
    } catch {
      // Not found
    }

    // Fallback: aria-label
    try {
      const nameInput = await this.page.waitForSelector(
        'input[aria-label="Your name"]',
        { timeout: 2000, visible: true }
      );
      if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(botName, { delay: 50 });
        console.log(
          `[GoogleMeetBot] Entered guest name via label: "${botName}"`
        );
        await this._sleep(500);
        return;
      }
    } catch {
      // Not found
    }

    // Last resort: any visible text input
    try {
      const inputs = await this.page.$$('input[type="text"]');
      if (inputs.length > 0) {
        await inputs[0].click({ clickCount: 3 });
        await inputs[0].type(botName, { delay: 50 });
        console.log("[GoogleMeetBot] Entered guest name via fallback input");
        await this._sleep(500);
        return;
      }
    } catch {
      // No input found
    }

    console.log(
      "[GoogleMeetBot] No name input found (may not be in guest mode)"
    );
  }

  async _muteMediaBeforeJoin() {
    // Mute mic
    try {
      const micBtn = await this.page.$(
        '[aria-label*="Turn off microphone"], [aria-label*="turn off microphone"], [data-tooltip*="Turn off microphone"]'
      );
      if (micBtn) {
        const visible = await micBtn.boundingBox();
        if (visible) {
          await micBtn.click();
          console.log("[GoogleMeetBot] Muted microphone");
        }
      }
    } catch {
      // Already muted or not found
    }

    // Mute camera
    try {
      const camBtn = await this.page.$(
        '[aria-label*="Turn off camera"], [aria-label*="turn off camera"], [data-tooltip*="Turn off camera"]'
      );
      if (camBtn) {
        const visible = await camBtn.boundingBox();
        if (visible) {
          await camBtn.click();
          console.log("[GoogleMeetBot] Muted camera");
        }
      }
    } catch {
      // Already muted or not found
    }

    await this._sleep(500);
  }

  async _clickJoinButton() {
    // Try specific button texts first, then broad fallback
    const handle = await this._findButtonByText(["Join now", "Ask to join", "join"]);
    const btn = handle ? handle.asElement() : null;

    if (btn) {
      const visible = await btn.boundingBox();
      if (visible) {
        const text = await this.page.evaluate((el) => el.innerText.trim(), btn);
        await btn.click();
        console.log(`[GoogleMeetBot] Clicked join button: "${text}"`);
        await this._sleep(2000);
        return;
      }
    }

    await this.page.screenshot({
      path: `debug-screenshots/debug-no-join-btn-${this.meetingId}.png`,
      fullPage: true,
    });
    throw new Error(
      "Could not find any join button — check debug-no-join-btn screenshot"
    );
  }

  async _waitForAdmission() {
    console.log("[GoogleMeetBot] Checking if waiting for host admission...");

    const maxWait = 300000; // 5 minutes
    const pollInterval = 3000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      // Check for leave/end call button (means we're in the meeting)
      const inMeeting = await this.page.$(
        '[aria-label="Leave call"], [aria-label="End call"], [data-tooltip="Leave call"]'
      );
      if (inMeeting) {
        const visible = await inMeeting.boundingBox();
        if (visible) {
          console.log(
            "[GoogleMeetBot] Admitted to the meeting (found call controls)"
          );
          return;
        }
      }

      const bodyText = await this.page.evaluate(
        () => document.body.innerText
      );

      // Check if denied or removed
      if (bodyText.includes("removed") || bodyText.includes("denied")) {
        const err = new Error("Host denied the bot's request to join.");
        err.noRetry = true;
        throw err;
      }

      // Still on waiting screen
      if (
        bodyText.includes("Asking to be let in") ||
        bodyText.includes("waiting for the host")
      ) {
        if ((Date.now() - start) % 15000 < pollInterval) {
          console.log(
            "[GoogleMeetBot] Still waiting for host to admit..."
          );
        }
        await this._sleep(pollInterval);
        continue;
      }

      // Might already be in
      if (
        bodyText.includes("Present now") ||
        bodyText.includes("Leave call") ||
        bodyText.includes("You're in the meeting") ||
        bodyText.includes("meeting details")
      ) {
        console.log("[GoogleMeetBot] Admitted to the meeting");
        return;
      }

      await this._sleep(pollInterval);
    }

    await this.page.screenshot({
      path: `debug-screenshots/debug-admission-timeout-${this.meetingId}.png`,
      fullPage: true,
    });
    console.log(
      `[GoogleMeetBot] Admission timeout screenshot saved: debug-admission-timeout-${this.meetingId}.png`
    );

    const err = new Error(
      "Timed out waiting for host to admit the bot (5 minutes)."
    );
    err.noRetry = true;
    throw err;
  }

  // --- Audio capture via WebRTC interception ---

  async _injectAudioInterceptor() {
    await this.page.evaluateOnNewDocument(() => {
      window.__meetAudioTracks = [];

      const OriginalRTCPeerConnection = window.RTCPeerConnection;

      window.RTCPeerConnection = function (...args) {
        const pc = new OriginalRTCPeerConnection(...args);

        pc.addEventListener("track", (event) => {
          if (event.track.kind === "audio") {
            console.log(
              "[AudioInterceptor] Captured audio track:",
              event.track.id
            );
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

      window.RTCPeerConnection.prototype =
        OriginalRTCPeerConnection.prototype;
      Object.keys(OriginalRTCPeerConnection).forEach((key) => {
        window.RTCPeerConnection[key] = OriginalRTCPeerConnection[key];
      });
      window.RTCPeerConnection.generateCertificate =
        OriginalRTCPeerConnection.generateCertificate;
    });
  }

  async _injectAudioInterceptorDirect() {
    // Direct injection — patches RTCPeerConnection in the current page context
    // This catches cases where evaluateOnNewDocument didn't fire
    const alreadyPatched = await this.page.evaluate(() => !!window.__meetAudioTracks);
    if (alreadyPatched) {
      console.log("[GoogleMeetBot] WebRTC interceptor already active (evaluateOnNewDocument worked)");
      return;
    }

    console.log("[GoogleMeetBot] Injecting WebRTC interceptor directly...");
    await this.page.evaluate(() => {
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
    console.log("[GoogleMeetBot] WebRTC interceptor injected directly");
  }

  async _startAudioCapture() {
    // Use Chrome DevTools Protocol to capture tab audio directly
    // This bypasses all WebRTC interception issues — captures whatever audio plays in the tab
    const cdp = await this.page.target().createCDPSession();

    // Start capturing tab audio as base64-encoded wav chunks
    // We use Page.startScreencast alternative: Browser.grantPermissions + WebAudio
    // Actually, the most reliable approach: use page.evaluate with getUserMedia + tab capture

    await this.page.exposeFunction("__onAudioChunk", (samples) => {
      const buffer = Buffer.from(new Int16Array(samples).buffer);
      this.onAudioData(buffer);
    });

    const captureStarted = await this.page.evaluate(() => {
      return new Promise(async (resolve) => {
        try {
          // Use getDisplayMedia with audio to capture tab audio
          // Chrome's --use-fake-ui-for-media-stream auto-accepts this
          let stream;

          // First try: capture audio from the current tab via getDisplayMedia
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: false,
              audio: {
                channelCount: 1,
                sampleRate: 16000,
              },
            });
          } catch (e1) {
            console.log("[AudioCapture] getDisplayMedia failed:", e1.message);

            // Second try: use Web Audio API to capture all audio context destinations
            // Create an AudioContext and use createMediaStreamDestination
            const audioContext = new AudioContext({ sampleRate: 16000 });

            // Find all audio/video elements and connect them
            const mediaElements = document.querySelectorAll("audio, video");
            const destination = audioContext.createMediaStreamDestination();
            let connected = 0;

            mediaElements.forEach((el) => {
              try {
                if (el.srcObject || el.src) {
                  const source = audioContext.createMediaElementSource(el);
                  source.connect(destination);
                  source.connect(audioContext.destination);
                  connected++;
                  console.log("[AudioCapture] Connected element:", el.tagName);
                }
              } catch (err) {
                console.log("[AudioCapture] Skip element:", err.message);
              }
            });

            if (connected > 0) {
              stream = destination.stream;
            } else {
              console.log("[AudioCapture] No media elements found, trying WebRTC tracks...");
              // Third try: use intercepted WebRTC tracks
              const tracks = window.__meetAudioTracks || [];
              if (tracks.length > 0) {
                stream = new MediaStream(tracks);
              }
            }
          }

          if (!stream || stream.getAudioTracks().length === 0) {
            console.log("[AudioCapture] No audio stream available");
            resolve(false);
            return;
          }

          console.log("[AudioCapture] Got audio stream with", stream.getAudioTracks().length, "tracks");

          // Process the audio stream
          const audioContext = new AudioContext({ sampleRate: 16000 });
          const source = audioContext.createMediaStreamSource(stream);
          const processor = audioContext.createScriptProcessor(4096, 1, 1);

          processor.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(data.length);
            for (let i = 0; i < data.length; i++) {
              int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
            }
            window.__onAudioChunk(Array.from(int16));
          };

          source.connect(processor);
          processor.connect(audioContext.destination);
          window.__audioContext = audioContext;

          console.log("[AudioCapture] Audio capture pipeline running");
          resolve(true);
        } catch (err) {
          console.error("[AudioCapture] Failed:", err.message);
          resolve(false);
        }
      });
    });

    if (captureStarted) {
      console.log("[GoogleMeetBot] Audio capture pipeline started");
    } else {
      console.log("[GoogleMeetBot] WARNING: Audio capture failed to start — trying fallback...");
      // Fallback: poll for WebRTC tracks
      await this._fallbackAudioCapture();
    }
  }

  async _fallbackAudioCapture() {
    // Poll for WebRTC tracks that may appear after joining
    for (let i = 0; i < 10; i++) {
      await this._sleep(3000);
      const trackCount = await this.page.evaluate(() => (window.__meetAudioTracks || []).length);
      console.log(`[GoogleMeetBot] Fallback polling... WebRTC tracks: ${trackCount}`);

      if (trackCount > 0) {
        await this.page.evaluate(() => {
          const tracks = window.__meetAudioTracks;
          const stream = new MediaStream(tracks);
          const audioContext = new AudioContext({ sampleRate: 16000 });
          const source = audioContext.createMediaStreamSource(stream);
          const processor = audioContext.createScriptProcessor(4096, 1, 1);

          processor.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(data.length);
            for (let i = 0; i < data.length; i++) {
              int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
            }
            window.__onAudioChunk(Array.from(int16));
          };

          source.connect(processor);
          processor.connect(audioContext.destination);
          window.__audioContext = audioContext;
          console.log("[AudioCapture] Fallback capture started with", tracks.length, "tracks");
        });
        console.log("[GoogleMeetBot] Fallback audio capture started");
        return;
      }
    }
    console.log("[GoogleMeetBot] WARNING: Could not capture any audio after 30 seconds");
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

  async _monitorMeetingEnd() {
    const pollInterval = 5000;
    console.log(`[GoogleMeetBot] Monitoring for meeting end: ${this.meetingId}`);

    while (this.status === "in_meeting" && this.page) {
      try {
        const bodyText = await this.page.evaluate(() => document.body.innerText);

        // Google Meet shows these when the meeting ends or the bot is removed
        const endSignals = [
          "You've been removed from the meeting",
          "The meeting has ended",
          "You left the meeting",
          "Return to home screen",
          "Returning to home screen",
          "The video call ended",
        ];

        const ended = endSignals.some((signal) => bodyText.includes(signal));
        if (ended) {
          console.log(`[GoogleMeetBot] Meeting ended detected for ${this.meetingId}`);
          if (this._meetingEndCallback) {
            this._meetingEndCallback(this.meetingId);
          } else {
            await this.leave();
          }
          return;
        }

        // Also check if browser/page was closed externally
      } catch (err) {
        // Page likely closed or crashed — meeting is over
        console.log(`[GoogleMeetBot] Page closed/crashed for ${this.meetingId}: ${err.message}`);
        if (this._meetingEndCallback) {
          this._meetingEndCallback(this.meetingId);
        }
        return;
      }

      await this._sleep(pollInterval);
    }
  }

  onAudioData(audioBuffer) {
    audioProcessor.processChunk(this.meetingId, audioBuffer);
  }
}

module.exports = GoogleMeetBot;
