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
};

export default function App() {
  const [meetingId, setMeetingId] = useState("");
  const [activeMeetingId, setActiveMeetingId] = useState(null);
  const { captions, connected } = useCaptions(activeMeetingId);

  const handleJoin = (e) => {
    e.preventDefault();
    if (meetingId.trim()) {
      setActiveMeetingId(meetingId.trim());
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
          placeholder="Enter meeting ID to view captions..."
          value={meetingId}
          onChange={(e) => setMeetingId(e.target.value)}
        />
        <button style={styles.button} type="submit">
          Connect
        </button>
      </form>

      {activeMeetingId && (
        <>
          <MeetingStatus meetingId={activeMeetingId} connected={connected} />
          <CaptionOverlay captions={captions} />
        </>
      )}
    </div>
  );
}
