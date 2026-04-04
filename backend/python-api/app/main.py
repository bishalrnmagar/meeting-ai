import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import meetings, transcripts, action_items, jira
from app.config import get_settings
from app.core.database import get_db
from app.core.redis_client import get_redis, close_redis
from app.models.transcript_line import TranscriptLine
from app.services.meeting_service import update_meeting_status


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown
    await close_redis()


app = FastAPI(
    title="Meeting AI Assistant",
    description="MVP - Meeting transcription, summarization, and action item extraction",
    version="1.0.0",
    lifespan=lifespan,
)

# Register API routes
app.include_router(meetings.router, prefix="/api/v1")
app.include_router(transcripts.router, prefix="/api/v1")
app.include_router(action_items.router, prefix="/api/v1")
app.include_router(jira.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok"}


# --- Internal API auth ---

async def verify_internal_key(x_api_key: str = Header(...)):
    if x_api_key != get_settings().internal_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


# --- WebSocket for live captions ---

class CaptionManager:
    def __init__(self):
        self.connections: dict[str, list[WebSocket]] = {}

    async def connect(self, meeting_id: str, websocket: WebSocket):
        await websocket.accept()
        if meeting_id not in self.connections:
            self.connections[meeting_id] = []
        self.connections[meeting_id].append(websocket)

    def disconnect(self, meeting_id: str, websocket: WebSocket):
        if meeting_id in self.connections:
            self.connections[meeting_id].remove(websocket)
            if not self.connections[meeting_id]:
                del self.connections[meeting_id]

    async def broadcast(self, meeting_id: str, data: dict):
        if meeting_id in self.connections:
            message = json.dumps(data)
            for ws in self.connections[meeting_id]:
                try:
                    await ws.send_text(message)
                except Exception:
                    pass


caption_manager = CaptionManager()


@app.websocket("/ws/captions/{meeting_id}")
async def captions_websocket(websocket: WebSocket, meeting_id: str):
    await caption_manager.connect(meeting_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        caption_manager.disconnect(meeting_id, websocket)


# --- Internal endpoints (called by Node bot orchestrator) ---

@app.post("/internal/captions/{meeting_id}")
async def push_caption(
    meeting_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_internal_key),
):
    """Receive a caption from the bot orchestrator, broadcast to WS clients, and store final lines in DB."""
    await caption_manager.broadcast(meeting_id, data)

    # Store final transcript lines in the database
    if data.get("is_final"):
        line = TranscriptLine(
            meeting_id=uuid.UUID(meeting_id),
            speaker=data.get("speaker"),
            content=data.get("content", ""),
            start_time=data.get("start_time", 0),
            end_time=data.get("end_time"),
            confidence=data.get("confidence"),
        )
        db.add(line)
        await db.commit()

    return {"ok": True}


@app.post("/internal/events/{meeting_id}")
async def meeting_event(
    meeting_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_internal_key),
):
    """Handle lifecycle events from the bot orchestrator (status changes, meeting ended)."""
    event = data.get("event")
    mid = uuid.UUID(meeting_id)

    if event == "status.update":
        status = data.get("status")
        kwargs = {}
        if status == "in_progress":
            kwargs["started_at"] = datetime.utcnow()
        meeting = await update_meeting_status(db, mid, status, **kwargs)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        return {"ok": True, "status": meeting.status}

    if event == "meeting.ended":
        meeting = await update_meeting_status(
            db, mid, "ended", ended_at=datetime.utcnow()
        )
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")

        # Publish to Redis Stream so post-meeting worker picks it up
        r = await get_redis()
        await r.xadd(
            "meeting:events",
            {"event": "meeting.ended", "meeting_id": meeting_id},
        )
        return {"ok": True, "status": "ended"}

    raise HTTPException(status_code=400, detail=f"Unknown event: {event}")
