import React, { useEffect, useRef } from "react";

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    maxHeight: "60vh",
    overflowY: "auto",
    padding: "1rem",
    background: "rgba(0, 0, 0, 0.7)",
    borderRadius: "12px",
    backdropFilter: "blur(10px)",
  },
  caption: {
    padding: "0.75rem 1rem",
    borderRadius: "8px",
    background: "rgba(255, 255, 255, 0.05)",
    borderLeft: "3px solid #4a9eff",
  },
  interim: {
    opacity: 0.6,
    borderLeftColor: "#666",
  },
  speaker: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#4a9eff",
    marginBottom: "0.25rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  text: {
    fontSize: "1rem",
    lineHeight: 1.5,
  },
  empty: {
    textAlign: "center",
    padding: "2rem",
    color: "#666",
    fontStyle: "italic",
  },
};

export default function CaptionOverlay({ captions }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [captions]);

  if (captions.length === 0) {
    return <div style={styles.empty}>Waiting for captions...</div>;
  }

  return (
    <div ref={containerRef} style={styles.container}>
      {captions.map((caption, i) => (
        <div
          key={i}
          style={{
            ...styles.caption,
            ...(caption.is_final ? {} : styles.interim),
          }}
        >
          <div style={styles.speaker}>{caption.speaker}</div>
          <div style={styles.text}>{caption.content}</div>
        </div>
      ))}
    </div>
  );
}
