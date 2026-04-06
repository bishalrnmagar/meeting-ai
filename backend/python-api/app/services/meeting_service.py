import re
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meeting import Meeting


def detect_platform(url: str) -> str:
    if "zoom.us" in url or "zoom.com" in url:
        return "zoom"
    if "meet.google.com" in url:
        return "google_meet"
    raise ValueError(f"Unsupported meeting URL: {url}")


def normalize_url(url: str) -> str:
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


async def create_meeting(db: AsyncSession, meeting_url: str, title: str | None = None, scheduled_at: datetime | None = None) -> Meeting:
    platform = detect_platform(meeting_url)
    meeting_url = normalize_url(meeting_url)
    meeting = Meeting(
        meeting_url=meeting_url,
        platform=platform,
        title=title,
        scheduled_at=scheduled_at,
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)
    return meeting


async def get_meeting(db: AsyncSession, meeting_id: uuid.UUID) -> Meeting | None:
    return await db.get(Meeting, meeting_id)


async def list_meetings(db: AsyncSession, limit: int = 50) -> list[Meeting]:
    result = await db.execute(select(Meeting).order_by(Meeting.created_at.desc()).limit(limit))
    return list(result.scalars().all())


async def update_meeting_status(db: AsyncSession, meeting_id: uuid.UUID, status: str, **kwargs) -> Meeting | None:
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        return None
    meeting.status = status
    for key, value in kwargs.items():
        setattr(meeting, key, value)
    meeting.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(meeting)
    return meeting
