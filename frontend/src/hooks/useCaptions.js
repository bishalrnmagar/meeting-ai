import { useState, useEffect, useRef, useCallback } from "react";

export function useCaptions(meetingId) {
  const [captions, setCaptions] = useState([]);
  const [connected, setConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState(null);
  const speakingTimeoutRef = useRef(null);
  const wsRef = useRef(null);

  const connect = useCallback(() => {
    if (!meetingId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/captions?meetingId=${meetingId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log("[WS] Connected");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("[WS] Message received:", data);

      if (data.type === "participant_count") {
        setParticipantCount(data.count);
        return;
      }

      if (data.type === "speaking_started") {
        setIsSpeaking(true);
        // Clear any pending stop timeout
        if (speakingTimeoutRef.current) {
          clearTimeout(speakingTimeoutRef.current);
          speakingTimeoutRef.current = null;
        }
        return;
      }

      if (data.type === "speaking_stopped") {
        // Small delay before marking as not speaking to avoid flickering
        speakingTimeoutRef.current = setTimeout(() => {
          setIsSpeaking(false);
        }, 500);
        return;
      }

      // Caption messages (type === "caption" or legacy messages without type)
      if (data.type === "caption" || !data.type) {
        // Update active speaker from transcript data
        if (data.speaker && data.speaker !== "Unknown") {
          setActiveSpeaker(data.speaker);
        }

        setCaptions((prev) => {
          // For interim results, replace the last non-final caption from same speaker
          if (!data.is_final) {
            const lastIdx = prev.length - 1;
            if (lastIdx >= 0 && !prev[lastIdx].is_final) {
              return [...prev.slice(0, lastIdx), data];
            }
            return [...prev, data];
          }
          // For final results, replace any interim and add as final
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && !prev[lastIdx].is_final) {
            return [...prev.slice(0, lastIdx), data];
          }
          return [...prev, data];
        });
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setIsSpeaking(false);
      setActiveSpeaker(null);
      console.log("[WS] Disconnected");
    };

    ws.onerror = (err) => {
      console.error("[WS] Error:", err);
    };
  }, [meetingId]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (speakingTimeoutRef.current) {
      clearTimeout(speakingTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return { captions, connected, participantCount, isSpeaking, activeSpeaker, connect, disconnect };
}
