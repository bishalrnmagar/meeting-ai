const BaseBot = require("./BaseBot");
const audioProcessor = require("../streaming/audioProcessor");

class ZoomBot extends BaseBot {
  constructor(meetingUrl, meetingId) {
    super(meetingUrl, meetingId);
    this.platform = "zoom";
    this.connection = null;
  }

  async join() {
    this.status = "joining";
    console.log(`[ZoomBot] Joining meeting: ${this.meetingUrl}`);

    // TODO: Integrate with Zoom Meeting SDK or Zoom Bot API
    // For MVP, this uses the Zoom Web SDK approach:
    // 1. Parse meeting ID and password from URL
    // 2. Join via SDK with JWT token
    // 3. Capture audio stream

    const meetingInfo = this._parseMeetingUrl();
    console.log(`[ZoomBot] Meeting ID: ${meetingInfo.meetingId}`);

    // Placeholder: In production, use @zoom/meetingsdk-web
    // await ZoomMtg.init({ ... });
    // await ZoomMtg.join({ ... });

    this.status = "in_meeting";
    console.log(`[ZoomBot] ✔ Bot joined meeting | meetingId=${this.meetingId} | platform=${this.platform}`);

    // Start audio processing pipeline
    audioProcessor.startProcessing(this.meetingId, this);

    return true;
  }

  async leave() {
    console.log(`[ZoomBot] Leaving meeting | meetingId=${this.meetingId} | platform=${this.platform}`);
    audioProcessor.stopProcessing(this.meetingId);
    this.status = "left";
    this.connection = null;
  }

  _parseMeetingUrl() {
    const url = new URL(this.meetingUrl);
    const pathParts = url.pathname.split("/");
    const meetingId = pathParts[pathParts.length - 1];
    const password = url.searchParams.get("pwd") || "";
    return { meetingId, password };
  }

  onAudioData(audioBuffer) {
    audioProcessor.processChunk(this.meetingId, audioBuffer);
  }
}

module.exports = ZoomBot;
