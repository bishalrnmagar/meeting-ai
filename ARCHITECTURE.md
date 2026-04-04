# Architecture Overview

This document explains the high-level flow of the Meeting AI Assistant MVP — what runs where, what triggers what, and how data moves through the system.

---

## System Diagram

```
┌──────────────┐     POST /api/v1/meetings      ┌───────────────────────┐
│   Frontend   │ ──────────────────────────────> │  Python API (FastAPI) │
│  React+Vite  │ <─── WebSocket (live captions)  │  :8000                │
│  :5173       │                                 │                       │
└──────────────┘                                 │  - Meeting CRUD       │
                                                 │  - Transcript storage │
                                                 │  - Action items       │
                                                 │  - Jira sync          │
                                                 │  - Summary generation │
                                                 └───────┬───────────────┘
                                                         │
                                         POST /internal/bots/start
                                         (with X-API-Key header)
                                                         │
                                                         ▼
                                                 ┌───────────────────────┐
                                                 │ Node Bot Orchestrator │
                                                 │ Express + WS  :3001  │
                                                 │                       │
                                                 │  - ZoomBot            │
                                                 │  - GoogleMeetBot      │
                                                 │  - Audio → Deepgram   │
                                                 │  - WS caption push    │
                                                 └───────┬───────────────┘
                                                         │
                                              Audio stream (PCM 16kHz)
                                                         │
                                                         ▼
                                                 ┌───────────────────┐
                                                 │  Deepgram Nova-2  │
                                                 │  (cloud ASR)      │
                                                 └───────────────────┘
```

---

## Entry Points

| Service | Entry File | Start Command |
|---------|-----------|---------------|
| Python API | `backend/python-api/app/main.py` | `uv run uvicorn app.main:app --reload --port 8000` |
| Bot Orchestrator | `backend/node-bot-orchestrator/src/index.js` | `yarn dev` |
| Frontend | `frontend/src/main.jsx` | `yarn dev` |
| Post-meeting Worker | `backend/python-api/app/workers/post_meeting_worker.py` | `uv run python -m app.workers.post_meeting_worker` |
| Infrastructure | `docker-compose.dev.yml` | `docker-compose -f docker-compose.dev.yml up -d` |

---

## Request Flow: Scheduling a Meeting

1. **User** sends `POST /api/v1/meetings` with `{ "meeting_url": "https://zoom.us/j/123" }`
2. **Python API** (`api/v1/meetings.py`) detects the platform from the URL, creates a `Meeting` row in PostgreSQL, and immediately calls the Node orchestrator
3. **Python API** sends `POST http://localhost:3001/internal/bots/start` with `{ meeting_id, meeting_url, platform }`
4. **Node Orchestrator** (`api/internalApi.js`) receives the request, validates the API key, and delegates to `botManager.startBot()`
5. **BotManager** (`orchestrator/botManager.js`) creates a `ZoomBot` or `GoogleMeetBot` instance and calls `bot.join()` with up to 3 retries (exponential backoff)

---

## Request Flow: Live Transcription

1. **Bot** (e.g., `GoogleMeetBot`) joins the meeting via Puppeteer, captures audio from the page using the Web Audio API
2. **Bot** passes raw PCM audio buffers to `audioProcessor.processChunk()`
3. **AudioProcessor** (`streaming/audioProcessor.js`) streams audio to **Deepgram Nova-2** over a persistent WebSocket
4. Deepgram returns transcript events (interim + final) back to `audioProcessor`
5. **AudioProcessor** does two things with each caption:
   - Broadcasts to frontend clients via `websocketHandler.broadcast()` (Node WS on `:3001`)
   - For final transcripts: sends `POST /internal/captions/{meeting_id}` to Python API for storage
6. **Python API** (`main.py → push_caption`) also broadcasts to any clients connected via its own WebSocket at `/ws/captions/{meeting_id}`

---

## Request Flow: Post-Meeting Processing

1. When a bot leaves, **BotManager** notifies the Python API that the meeting ended
2. A `meeting.ended` event is published to **Redis Streams** (`meeting:events` stream)
3. **Post-meeting Worker** (`workers/post_meeting_worker.py`) picks up the event from the stream
4. Worker fetches all `TranscriptLine` rows for the meeting from PostgreSQL
5. Worker runs **two tasks in parallel**:
   - `summarizer.summarize_transcript()` → calls GPT-4o-mini (chunks long transcripts into ~15-min segments, then merges)
   - `action_extractor.extract_action_items()` → calls GPT-4o-mini with few-shot prompt, returns JSON array
6. Worker saves the summary to the `Meeting.summary` field and creates `ActionItem` rows
7. Action items are created with `jira_sync_status='pending'`

---

## Request Flow: Jira Sync

1. User calls `POST /api/v1/action-items/{id}/sync-jira` (single item) or `POST /api/v1/jira/sync` (batch all pending)
2. **Python API** (`services/jira_client.py`) creates Jira issues via the Jira REST API v2
3. On success: `jira_sync_status` → `synced`, `jira_ticket_id` is stored
4. On failure: `jira_sync_status` → `failed` (retried on next batch sync)

---

## Data Model

```
meetings
  ├── transcript_lines[]    (one per utterance, ordered by start_time)
  └── action_items[]        (extracted post-meeting by LLM)
```

- **meetings**: core entity — tracks URL, platform, status lifecycle (`scheduled → joining → in_progress → ended`)
- **transcript_lines**: individual speaker utterances with timestamps, confidence scores
- **action_items**: extracted tasks with optional owner, due date, priority, and Jira sync state

---

## Key Files by Responsibility

| What | File |
|------|------|
| FastAPI app + WebSocket + routes | `python-api/app/main.py` |
| Meeting CRUD logic | `python-api/app/services/meeting_service.py` |
| GPT-4o-mini summarization | `python-api/app/services/summarizer.py` |
| Action item extraction (few-shot) | `python-api/app/services/action_extractor.py` |
| Jira ticket creation | `python-api/app/services/jira_client.py` |
| Redis Streams consumer | `python-api/app/workers/post_meeting_worker.py` |
| Bot lifecycle management | `node-bot-orchestrator/src/orchestrator/botManager.js` |
| Google Meet Puppeteer bot | `node-bot-orchestrator/src/bots/GoogleMeetBot.js` |
| Zoom bot (SDK placeholder) | `node-bot-orchestrator/src/bots/ZoomBot.js` |
| Audio → Deepgram streaming | `node-bot-orchestrator/src/streaming/audioProcessor.js` |
| WebSocket caption broadcast | `node-bot-orchestrator/src/streaming/websocketHandler.js` |
| React caption UI | `frontend/src/App.jsx` |
| WebSocket hook | `frontend/src/hooks/useCaptions.js` |
| DB schema | `scripts/init_db.sql` |
