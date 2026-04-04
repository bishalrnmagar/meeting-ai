const BaseBot = require("./BaseBot");
const audioProcessor = require("../streaming/audioProcessor");
const config = require("../config");

class GoogleMeetBot extends BaseBot {
  constructor(meetingUrl, meetingId) {
    super(meetingUrl, meetingId);
    this.platform = "google_meet";
    this.browser = null;
    this.page = null;
  }

  async join() {
    this.status = "joining";
    console.log(`[GoogleMeetBot] Joining meeting: ${this.meetingUrl}`);

    // Launch headful Chromium via Puppeteer
    const puppeteer = require("puppeteer");
    this.browser = await puppeteer.launch({
      headless: config.googleMeetHeadless,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });

    this.page = await this.browser.newPage();

    // Set permissions for microphone/camera
    const context = this.browser.defaultBrowserContext();
    await context.overridePermissions("https://meet.google.com", [
      "microphone",
      "camera",
      "notifications",
    ]);

    await this.page.goto(this.meetingUrl, { waitUntil: "networkidle2" });

    // Dismiss "Got it" / "Join now" dialogs
    await this._dismissDialogs();

    // Mute mic and camera before joining
    await this._muteMediaBeforeJoin();

    // Click "Join now" or "Ask to join"
    await this._clickJoinButton();

    this.status = "in_meeting";

    // Start capturing audio via Web Audio API in the page
    await this._startAudioCapture();

    // Start audio processing pipeline
    audioProcessor.startProcessing(this.meetingId, this);

    return true;
  }

  async leave() {
    console.log(`[GoogleMeetBot] Leaving meeting: ${this.meetingId}`);
    audioProcessor.stopProcessing(this.meetingId);

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
    this.status = "left";
  }

  async _dismissDialogs() {
    try {
      // Click "Got it" button if present
      const gotIt = await this.page.$('button[jsname="IbE0ye"]');
      if (gotIt) await gotIt.click();
      await this.page.waitForTimeout(1000);
    } catch {
      // Dialog may not appear
    }
  }

  async _muteMediaBeforeJoin() {
    try {
      // Toggle mic off
      const micButton = await this.page.$(
        '[data-is-muted="false"][aria-label*="microphone"]'
      );
      if (micButton) await micButton.click();

      // Toggle camera off
      const camButton = await this.page.$(
        '[data-is-muted="false"][aria-label*="camera"]'
      );
      if (camButton) await camButton.click();
    } catch {
      // Already muted or selectors changed
    }
  }

  async _clickJoinButton() {
    try {
      await this.page.waitForSelector('button[jsname="Qx7uuf"]', { timeout: 15000 });
      await this.page.click('button[jsname="Qx7uuf"]');
      await this.page.waitForTimeout(3000);
    } catch {
      // Try alternative "Ask to join" button
      const askJoin = await this.page.$('button[data-idom-class*="join"]');
      if (askJoin) await askJoin.click();
    }
  }

  async _startAudioCapture() {
    // Inject script to capture audio via Web Audio API and send to Node via WebSocket
    await this.page.evaluate(() => {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const dest = audioContext.createMediaStreamDestination();

      // Capture all audio elements on the page
      document.querySelectorAll("audio, video").forEach((el) => {
        try {
          const source = audioContext.createMediaElementSource(el);
          source.connect(dest);
          source.connect(audioContext.destination);
        } catch {
          // Element may already be connected
        }
      });

      // Use ScriptProcessor to get raw PCM data
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      dest.stream.getAudioTracks().forEach((track) => {
        const source = audioContext.createMediaStreamSource(
          new MediaStream([track])
        );
        source.connect(processor);
      });

      processor.connect(audioContext.destination);
      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16
        const int16 = new Int16Array(data.length);
        for (let i = 0; i < data.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
        }
        // Send to parent via window message
        window.postMessage({ type: "audio-data", samples: Array.from(int16) }, "*");
      };
    });

    // Listen for audio data from the page
    await this.page.exposeFunction("_onAudioData", (samples) => {
      const buffer = Buffer.from(new Int16Array(samples).buffer);
      this.onAudioData(buffer);
    });

    await this.page.evaluate(() => {
      window.addEventListener("message", (e) => {
        if (e.data?.type === "audio-data") {
          window._onAudioData(e.data.samples);
        }
      });
    });
  }

  onAudioData(audioBuffer) {
    audioProcessor.processChunk(this.meetingId, audioBuffer);
  }
}

module.exports = GoogleMeetBot;
