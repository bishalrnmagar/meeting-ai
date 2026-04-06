import asyncio
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db
from app.schemas.meeting import MeetingCreate, MeetingResponse
from app.services.meeting_service import create_meeting, get_meeting, list_meetings

router = APIRouter(prefix="/meetings", tags=["meetings"])


async def _notify_bot_orchestrator(meeting_id: str, meeting_url: str, platform: str):
    """Fire-and-forget: tell the bot orchestrator to join the meeting."""
    settings = get_settings()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "http://localhost:3001/internal/bots/start",
                json={"meeting_id": meeting_id, "meeting_url": meeting_url, "platform": platform},
                headers={"X-API-Key": settings.internal_api_key},
                timeout=120,
            )
            if resp.status_code != 200:
                print(f"[Meetings] Bot orchestrator returned {resp.status_code}: {resp.text}")
            else:
                print(f"[Meetings] Bot joined successfully for {meeting_id}")
    except httpx.ConnectError:
        print("[Meetings] Bot orchestrator is not running — bot will not join")
    except Exception as e:
        print(f"[Meetings] Failed to notify bot orchestrator: {e}")


@router.post("", response_model=MeetingResponse, status_code=201)
async def schedule_meeting(body: MeetingCreate, db: AsyncSession = Depends(get_db)):
    try:
        meeting = await create_meeting(db, body.meeting_url, body.title, body.scheduled_at)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Notify bot orchestrator in the background — don't block the response
    asyncio.create_task(
        _notify_bot_orchestrator(str(meeting.id), meeting.meeting_url, meeting.platform)
    )

    return meeting


@router.get("", response_model=list[MeetingResponse])
async def list_all_meetings(db: AsyncSession = Depends(get_db)):
    return await list_meetings(db)


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting_by_id(meeting_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    meeting = await get_meeting(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting
