import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db
from app.schemas.meeting import MeetingCreate, MeetingResponse
from app.services.meeting_service import create_meeting, get_meeting, list_meetings

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.post("", response_model=MeetingResponse, status_code=201)
async def schedule_meeting(body: MeetingCreate, db: AsyncSession = Depends(get_db)):
    try:
        meeting = await create_meeting(db, body.meeting_url, body.title, body.scheduled_at)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Notify bot orchestrator to join
    settings = get_settings()
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                "http://localhost:3001/internal/bots/start",
                json={"meeting_id": str(meeting.id), "meeting_url": meeting.meeting_url, "platform": meeting.platform},
                headers={"X-API-Key": settings.internal_api_key},
                timeout=10,
            )
    except Exception:
        pass  # Bot orchestrator may not be running; meeting is still created

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
