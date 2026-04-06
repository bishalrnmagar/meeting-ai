const http = require("http");
const express = require("express");
const cors = require("cors");
const config = require("./config");
const internalApi = require("./api/internalApi");
const websocketHandler = require("./streaming/websocketHandler");

// Catch unhandled errors to prevent crashes
process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled rejection:", reason);
});

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "bot-orchestrator" });
});

// Internal API (called by Python control plane)
app.use("/internal", internalApi);

// Create HTTP server and attach WebSocket
const server = http.createServer(app);
websocketHandler.init(server);

server.listen(config.port, () => {
  console.log(`[Orchestrator] Running on port ${config.port}`);
  console.log(`[Orchestrator] WebSocket at ws://localhost:${config.port}/ws/captions`);
});
