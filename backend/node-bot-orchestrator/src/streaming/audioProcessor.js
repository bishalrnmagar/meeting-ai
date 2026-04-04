const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const config = require("../config");
const websocketHandler = require("./websocketHandler");

const activeStreams = new Map();

function startProcessing(meetingId, bot) {
  if (activeStreams.has(meetingId)) return;

  const deepgram = createClient(config.deepgramApiKey);

  const connection = deepgram.listen.live({
    model: "nova-2",
    language: "en",
    smart_format: true,
    interim_results: true,
    utterance_end_ms: 1500,
    vad_events: true,
    diarize: true,
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log(`[AudioProcessor] Deepgram stream opened for ${meetingId}`);
  });

  connection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel?.alternatives?.[0];
    if (!transcript?.transcript) return;

    const caption = {
      meeting_id: meetingId,
      speaker: transcript.words?.[0]?.speaker
        ? `Speaker ${transcript.words[0].speaker}`
        : "Unknown",
      content: transcript.transcript,
      start_time: data.start || 0,
      end_time: (data.start || 0) + (data.duration || 0),
      confidence: transcript.confidence || 0,
      is_final: data.is_final || false,
    };

    // Push to WebSocket clients
    websocketHandler.broadcast(meetingId, caption);

    // If final, store transcript line via Python API
    if (caption.is_final) {
      try {
        await fetch(`${config.pythonApiUrl}/internal/captions/${meetingId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(caption),
        });
      } catch (err) {
        console.error("[AudioProcessor] Failed to store transcript:", err.message);
      }
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error(`[AudioProcessor] Deepgram error for ${meetingId}:`, err);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    console.log(`[AudioProcessor] Deepgram stream closed for ${meetingId}`);
    activeStreams.delete(meetingId);
  });

  activeStreams.set(meetingId, connection);
}

function processChunk(meetingId, audioBuffer) {
  const connection = activeStreams.get(meetingId);
  if (connection) {
    connection.send(audioBuffer);
  }
}

function stopProcessing(meetingId) {
  const connection = activeStreams.get(meetingId);
  if (connection) {
    connection.finish();
    activeStreams.delete(meetingId);
  }
}

module.exports = { startProcessing, processChunk, stopProcessing };
