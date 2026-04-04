class BaseBot {
  constructor(meetingUrl, meetingId) {
    this.meetingUrl = meetingUrl;
    this.meetingId = meetingId;
    this.status = "initialized";
    this.platform = "unknown";
  }

  async join() {
    throw new Error("join() must be implemented by subclass");
  }

  async leave() {
    throw new Error("leave() must be implemented by subclass");
  }

  async captureAudio() {
    throw new Error("captureAudio() must be implemented by subclass");
  }
}

module.exports = BaseBot;
