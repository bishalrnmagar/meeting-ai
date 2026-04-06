const WebSocket = require("ws");

let wss = null;
const meetingClients = new Map(); // meetingId -> Set<WebSocket>

function init(server) {
  wss = new WebSocket.Server({ server, path: "/ws/captions" });

  wss.on("connection", (ws, req) => {
    // Extract meeting ID from URL: /ws/captions?meetingId=xxx
    const url = new URL(req.url, `http://${req.headers.host}`);
    const meetingId = url.searchParams.get("meetingId");

    if (!meetingId) {
      ws.close(4000, "Missing meetingId parameter");
      return;
    }

    if (!meetingClients.has(meetingId)) {
      meetingClients.set(meetingId, new Set());
    }
    meetingClients.get(meetingId).add(ws);

    console.log(`[WS] Client connected for meeting ${meetingId}`);

    ws.on("close", () => {
      const clients = meetingClients.get(meetingId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) meetingClients.delete(meetingId);
      }
      console.log(`[WS] Client disconnected from meeting ${meetingId}`);
    });

    ws.on("error", (err) => {
      console.error(`[WS] Error for meeting ${meetingId}:`, err.message);
    });
  });

  console.log("[WS] WebSocket server initialized");
}

function broadcast(meetingId, data) {
  const clients = meetingClients.get(meetingId);
  if (!clients || clients.size === 0) {
    console.log(`[WS] No clients connected for meeting ${meetingId}, skipping broadcast`);
    return;
  }

  const message = JSON.stringify(data);
  let sentCount = 0;
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      sentCount++;
    }
  }
  console.log(`[WS] Broadcast to ${sentCount}/${clients.size} clients for meeting ${meetingId}`);
}

module.exports = { init, broadcast };
