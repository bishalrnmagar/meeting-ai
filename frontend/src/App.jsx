import React, { useState } from "react";
import { useCaptions } from "./hooks/useCaptions";
import CaptionOverlay from "./components/CaptionOverlay";
import MeetingStatus from "./components/MeetingStatus";

const styles = {
  header: {
    textAlign: "center",
    marginBottom: "2rem",
  },
  title: {
    fontSize: "1.8rem",
    fontWeight: 700,
    marginBottom: "0.5rem",
  },
  subtitle: {
    color: "#888",
    fontSize: "0.95rem",
  },
  inputRow: {
    display: "flex",
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  input: {
    flex: 1,
    padding: "0.75rem 1rem",
    borderRadius: "8px",
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#e0e0e0",
    fontSize: "1rem",
    outline: "none",
  },
  button: {
    padding: "0.75rem 1.5rem",
    borderRadius: "8px",
    border: "none",
    background: "#4a9eff",
    color: "#fff",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  buttonDisabled: {
    padding: "0.75rem 1.5rem",
    borderRadius: "8px",
    border: "none",
    background: "#555",
    color: "#999",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "not-allowed",
  },
  error: {
    color: "#f44336",
    fontSize: "0.9rem",
    marginBottom: "1rem",
  },
};

export default function App() {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [activeMeetingId, setActiveMeetingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { captions, connected, participantCount } = useCaptions(activeMeetingId);

  const handleJoin = async (e) => {
    e.preventDefault();
    const url = meetingUrl.trim();
    if (!url) return;

    setLoading(true);
    setError(null);

    try {
      // Call the Python API to create the meeting and trigger the bot
      const resp = await fetch("/api/v1/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_url: url }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || `Server error: ${resp.status}`);
      }

      const meeting = await resp.json();
      console.log("[App] Meeting created, bot starting:", meeting);
      setActiveMeetingId(meeting.id);
    } catch (err) {
      console.error("[App] Failed to start meeting:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <div style={styles.title}>Meeting AI Assistant</div>
        <div style={styles.subtitle}>Real-time captions powered by Deepgram</div>
      </div>

      <form onSubmit={handleJoin} style={styles.inputRow}>
        <input
          style={styles.input}
          type="text"
          placeholder="Paste a Zoom or Google Meet link..."
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
        />
        <button
          style={loading ? styles.buttonDisabled : styles.button}
          type="submit"
          disabled={loading}
        >
          {loading ? "Joining..." : "Join Meeting"}
        </button>
      </form>

      {error && <div style={styles.error}>{error}</div>}

      {activeMeetingId && (
        <>
          <MeetingStatus
            meetingId={activeMeetingId}
            connected={connected}
            participantCount={participantCount}
          />
          <CaptionOverlay captions={captions} />
        </>
      )}
    </div>
  );
}
