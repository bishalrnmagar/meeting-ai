const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const config = require("../config");
const websocketHandler = require("./websocketHandler");

const activeStreams = new Map();

function startProcessing(meetingId, bot) {
  if (activeStreams.has(meetingId)) return;

  console.log(`[AudioProcessor] Starting Deepgram stream for ${meetingId}...`);

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

  // Track readiness so we don't send before the socket is open
  let isReady = false;
  const pendingChunks = [];

  connection.on(LiveTranscriptionEvents.Open, () => {
    isReady = true;
    console.log(`[AudioProcessor] Deepgram stream opened for ${meetingId}`);
    // Flush any chunks that arrived before the connection was ready
    while (pendingChunks.length > 0) {
      connection.send(pendingChunks.shift());
    }
  });

  connection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel?.alternatives?.[0];
    if (!transcript?.transcript) return;

    console.log(`[AudioProcessor] Transcript received for ${meetingId}: "${transcript.transcript}" (final=${data.is_final})`);

    const caption = {
      meeting_id: meetingId,
      speaker: transcript.words?.[0]?.speaker != null
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
    console.error(`[AudioProcessor] Deepgram error for ${meetingId}:`, err.message || err);
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    isReady = false;
    console.log(`[AudioProcessor] Deepgram stream closed for ${meetingId}`);
    activeStreams.delete(meetingId);

    // Auto-reconnect if the bot is still in the meeting
    if (bot && bot.status === "in_meeting") {
      console.log(`[AudioProcessor] Reconnecting Deepgram stream for ${meetingId}...`);
      setTimeout(() => startProcessing(meetingId, bot), 2000);
    }
  });

  // Store both the connection and readiness state
  activeStreams.set(meetingId, { connection, isReady: () => isReady, pendingChunks });
}

function processChunk(meetingId, audioBuffer) {
  const stream = activeStreams.get(meetingId);
  if (!stream) {
    console.log(`[AudioProcessor] No active stream for ${meetingId}, dropping chunk`);
    return;
  }

  try {
    if (stream.isReady()) {
      stream.connection.send(audioBuffer);
    } else {
      // Buffer chunks until Deepgram connection is open
      stream.pendingChunks.push(audioBuffer);
    }
  } catch (err) {
    console.error(`[AudioProcessor] Send error for ${meetingId}:`, err.message);
  }
}

function stopProcessing(meetingId) {
  const stream = activeStreams.get(meetingId);
  if (stream) {
    stream.connection.finish();
    activeStreams.delete(meetingId);
    console.log(`[AudioProcessor] Stopped processing for ${meetingId}`);
  }
}

module.exports = { startProcessing, processChunk, stopProcessing };
