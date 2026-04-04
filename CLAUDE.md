# CLAUDE.md - Meeting AI Assistant (MVP)

## Project Overview (MVP Scope)

**Product:** Meeting AI Assistant – MVP version.

**Capabilities:**
- Join Zoom and Google Meet calls as a bot participant
- Real-time English transcription with speaker diarization
- Live captions displayed via WebSocket
- Post-meeting: generate executive summary + action items (task, owner, due date if mentioned)
- Create Jira tickets automatically from action items

**Explicitly Out of Scope for MVP:**
- Real-time translation
- Slack / Notion / CRM integrations
- Semantic search / knowledge base
- Teams support (post-MVP)
- Advanced analytics or sentiment analysis

**Target Users:** Engineering teams, project managers using Zoom/Meet + Jira.

---

## Tech Stack (MVP - No Infra)

| Layer | Technology | Purpose |
|-------|------------|---------|
| Control Plane API | Python 3.11+ / FastAPI | Meeting management, summary, action items, Jira sync |
| Bot Orchestrator | Node.js 20+ / Express + MediaSoup | Real-time bot joining, audio capture |
| Real-time ASR | Deepgram (Nova-2) | English speech-to-text + diarization |
| LLM (Summarization) | OpenAI GPT-4o-mini | Post-meeting summary & action extraction |
| Database | PostgreSQL + SQLAlchemy | Meetings, transcripts (lines), action items |
| State/Cache | Redis | Session state, live caption buffer |
| Queue | Redis Streams (simple) | Async post-meeting jobs |
| Frontend (optional) | React + Vite + WebSocket | Live captions overlay |

---

## Folder Structure (MVP)

```
backend/
├── python-api/                     # FastAPI control plane
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── api/v1/
│   │   │   ├── meetings.py         # POST /meetings (schedule), GET /meetings/{id}
│   │   │   ├── transcripts.py      # GET /transcripts/{meeting_id}
│   │   │   ├── action_items.py     # GET/POST action items
│   │   │   └── jira.py             # POST /jira/sync (manual or auto)
│   │   ├── core/
│   │   │   ├── database.py         # SQLAlchemy async engine
│   │   │   └── redis_client.py     # Redis connection
│   │   ├── models/
│   │   │   ├── meeting.py
│   │   │   ├── transcript_line.py
│   │   │   └── action_item.py
│   │   ├── services/
│   │   │   ├── meeting_service.py  # schedule, get status
│   │   │   ├── summarizer.py       # GPT-4o-mini summarization
│   │   │   ├── action_extractor.py # extract tasks/owners/dates
│   │   │   └── jira_client.py      # create Jira tickets
│   │   ├── workers/
│   │   │   └── post_meeting_worker.py  # consumes meeting.ended events
│   │   └── schemas/                # Pydantic models
│   │       ├── meeting.py
│   │       ├── transcript.py
│   │       └── action_item.py
│   ├── requirements.txt
│   └── .env.example
│
├── node-bot-orchestrator/          # Node.js bot control
│   ├── src/
│   │   ├── index.js
│   │   ├── config.js
│   │   ├── orchestrator/
│   │   │   ├── botManager.js       # start/stop bots, pool
│   │   │   └── sessionStore.js     # meetingId -> bot instance
│   │   ├── bots/
│   │   │   ├── BaseBot.js          # interface
│   │   │   ├── ZoomBot.js          # Zoom SDK / JWT join
│   │   │   └── GoogleMeetBot.js    # Puppeteer + WebRTC
│   │   ├── streaming/
│   │   │   ├── audioProcessor.js   # Opus -> PCM, chunking
│   │   │   └── websocketHandler.js # push captions to frontend
│   │   └── api/
│   │       └── internalApi.js      # receive start/stop from Python
│   ├── package.json
│   └── .env.example
│
├── docker-compose.dev.yml          # PostgreSQL + Redis only
└── scripts/
    ├── init_db.sql
    └── run_dev.sh
```

---

## Core Principles (MVP)

### 1. Simplicity over Scalability (for now)
- No Kafka – use Redis Streams for job queue.
- No Kubernetes – run locally or single-server Docker.
- No vector DB – search not needed.

### 2. Real-time Latency Target
- End-to-end caption latency: ≤ 3 seconds.
- Deepgram interim results every 500ms.

### 3. Error Handling
- Bot join retry: 3 attempts with exponential backoff.
- If Jira API fails, store action item with `status='pending'` and retry on next meeting end.

### 4. Data Storage
- Store raw transcript lines in PostgreSQL (not just final).
- No raw audio storage in MVP (GDPR light).

### 5. LLM Prompting (Action Items)
- Use few-shot examples to extract: task, owner, due_date.
- If no owner mentioned → owner = null.
- If no due date → due_date = null.
- Never hallucinate.

---

## Environment Variables (MVP)

```ini
# Python API
DATABASE_URL=postgresql://user:pass@localhost:5433/meetingai
REDIS_URL=redis://localhost:6379
DEEPGRAM_API_KEY=your_key
OPENAI_API_KEY=your_key
JIRA_URL=https://your-domain.atlassian.net
JIRA_EMAIL=admin@example.com
JIRA_API_TOKEN=your_token

# Node Orchestrator
PORT=3001
REDIS_URL=redis://localhost:6379
INTERNAL_API_KEY=shared-secret
ZOOM_JWT_TOKEN=your_token
GOOGLE_MEET_HEADLESS=true
```

---

## Local Development (No Infra)

```bash
# 1. Start PostgreSQL + Redis
docker-compose -f docker-compose.dev.yml up -d

# 2. Python API
cd backend/python-api
uv sync
uv run uvicorn app.main:app --reload --port 8000

# 3. Node orchestrator
cd backend/node-bot-orchestrator
yarn install
yarn dev

# 4. (Optional) Frontend for captions
cd frontend
yarn install && yarn dev
```

---

## Common Commands

| Task | Command |
|------|---------|
| Run DB migrations | `uv run alembic upgrade head` |
| Generate migration | `uv run alembic revision --autogenerate -m "desc"` |
| Run post-meeting worker manually | `uv run python -m app.workers.post_meeting_worker` |
| Test bot join (Zoom) | `curl -X POST http://localhost:8000/api/v1/meetings -d '{"meeting_url":"zoom.us/..."}'` |
| Format Python code | `uv run black app/` |
| Lint Node code | `yarn lint` |

---

## Known MVP Limitations & Workarounds

| Limitation | Workaround |
|------------|-------------|
| Google Meet bot detection | Use headful Chromium + random mouse movements; recommend browser extension for production |
| Speaker diarization drift | Deepgram Nova-2 is stable within a session; no persistent speaker IDs needed for MVP |
| Jira rate limits (100/min) | Queue action items and send in batches every 5 seconds |
| Long meetings (>2 hours) | LLM chunk transcript into 15-min segments, then merge summaries |
| No real-time translation | MVP English only – add in Phase 2 |

---

## API Endpoints (MVP)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/meetings` | Schedule a meeting (bot will auto-join at time) |
| GET | `/api/v1/meetings/{id}` | Get meeting status + transcript URL |
| GET | `/api/v1/transcripts/{id}` | Full transcript (JSON) |
| GET | `/api/v1/action-items/{meeting_id}` | List extracted action items |
| POST | `/api/v1/action-items/{id}/sync-jira` | Manually push to Jira |
| WS | `/ws/captions/{meeting_id}` | Live captions stream |

---

## Example Action Item Output (LLM)

```json
{
  "task": "Fix login page validation",
  "owner": "alice@company.com",
  "due_date": "2026-04-10",
  "priority": "high",
  "source_sentence": "Alice said she will fix the login validation by Friday"
}
```

---

## When Asking for Help (Claude Prompts)

Be specific about MVP scope:

- *"In the Python summarizer, how do I chunk a 3-hour transcript for GPT-4o-mini?"*
- *"My ZoomBot fails to join when waiting room is enabled – here's the error..."*
- *"The action extractor is missing implicit owners (e.g., 'the backend team should...') – improve prompt."*
- *"How to test Google Meet bot locally without triggering anti-bot?"*

---

**MVP Delivery Checklist:**
- [ ] Bot joins Zoom meeting via link
- [ ] Bot joins Google Meet (headful mode)
- [ ] Real-time captions appear in WebSocket
- [ ] After meeting, summary is generated
- [ ] Action items extracted with owners
- [ ] Jira ticket created automatically
- [ ] No translation, no Slack, no search
