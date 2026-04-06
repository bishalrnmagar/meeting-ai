import React from "react";

const styles = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "1rem 1.5rem",
    background: "rgba(255, 255, 255, 0.05)",
    borderRadius: "12px",
    marginBottom: "1rem",
  },
  dot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  connected: {
    background: "#4caf50",
    boxShadow: "0 0 8px rgba(76, 175, 80, 0.5)",
  },
  disconnected: {
    background: "#f44336",
  },
  title: {
    fontSize: "1.1rem",
    fontWeight: 600,
  },
  meetingId: {
    fontSize: "0.8rem",
    color: "#888",
    fontFamily: "monospace",
  },
  rightSection: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "1.25rem",
  },
  participants: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.9rem",
    color: "#ccc",
    background: "rgba(255, 255, 255, 0.07)",
    padding: "0.35rem 0.75rem",
    borderRadius: "16px",
  },
  participantIcon: {
    fontSize: "0.85rem",
  },
  participantCount: {
    fontWeight: 600,
  },
  status: {
    fontSize: "0.85rem",
    color: "#aaa",
  },
};

export default function MeetingStatus({ meetingId, connected, participantCount }) {
  return (
    <div style={styles.container}>
      <div
        style={{
          ...styles.dot,
          ...(connected ? styles.connected : styles.disconnected),
        }}
      />
      <div>
        <div style={styles.title}>Live Captions</div>
        <div style={styles.meetingId}>{meetingId}</div>
      </div>
      <div style={styles.rightSection}>
        {participantCount !== null && (
          <div style={styles.participants}>
            <span style={styles.participantIcon}>👤</span>
            <span style={styles.participantCount}>{participantCount}</span>
            <span>in meeting</span>
          </div>
        )}
        <div style={styles.status}>
          {connected ? "Connected" : "Disconnected"}
        </div>
      </div>
    </div>
  );
}
