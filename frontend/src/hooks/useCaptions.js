import { useState, useEffect, useRef, useCallback } from "react";

export function useCaptions(meetingId) {
  const [captions, setCaptions] = useState([]);
  const [connected, setConnected] = useState(false);
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
    };

    ws.onclose = () => {
      setConnected(false);
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
  }, []);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  return { captions, connected, connect, disconnect };
}
