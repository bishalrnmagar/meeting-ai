import React from "react";

const styles = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.75rem 1.25rem",
    background: "rgba(255, 255, 255, 0.05)",
    borderRadius: "10px",
    marginBottom: "1rem",
    transition: "all 0.3s ease",
  },
  containerActive: {
    background: "rgba(74, 158, 255, 0.1)",
    border: "1px solid rgba(74, 158, 255, 0.25)",
  },
  containerIdle: {
    border: "1px solid rgba(255, 255, 255, 0.08)",
  },
  barsWrapper: {
    display: "flex",
    alignItems: "center",
    gap: "3px",
    height: "24px",
  },
  bar: {
    width: "4px",
    borderRadius: "2px",
    transition: "height 0.15s ease, background 0.3s ease",
  },
  label: {
    fontSize: "0.9rem",
    fontWeight: 500,
  },
  speakerName: {
    fontSize: "0.8rem",
    color: "#4a9eff",
    fontWeight: 600,
  },
  silentText: {
    color: "#666",
    fontStyle: "italic",
  },
};

const BAR_COUNT = 5;

export default function SpeakingIndicator({ isSpeaking, activeSpeaker }) {
  return (
    <div
      style={{
        ...styles.container,
        ...(isSpeaking ? styles.containerActive : styles.containerIdle),
      }}
    >
      <div style={styles.barsWrapper}>
        {Array.from({ length: BAR_COUNT }).map((_, i) => (
          <div
            key={i}
            style={{
              ...styles.bar,
              height: isSpeaking ? `${10 + Math.random() * 14}px` : "4px",
              background: isSpeaking ? "#4a9eff" : "#444",
              animation: isSpeaking
                ? `speaking-bar 0.4s ease-in-out ${i * 0.08}s infinite alternate`
                : "none",
            }}
          />
        ))}
      </div>
      <div>
        {isSpeaking ? (
          <>
            <div style={styles.label}>Someone is speaking</div>
            {activeSpeaker && activeSpeaker !== "Unknown" && (
              <div style={styles.speakerName}>{activeSpeaker}</div>
            )}
          </>
        ) : (
          <div style={{ ...styles.label, ...styles.silentText }}>
            No one is speaking
          </div>
        )}
      </div>
    </div>
  );
}
