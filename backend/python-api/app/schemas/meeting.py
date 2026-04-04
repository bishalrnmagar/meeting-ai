from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, HttpUrl


class MeetingCreate(BaseModel):
    meeting_url: str
    title: str | None = None
    scheduled_at: datetime | None = None


class MeetingResponse(BaseModel):
    id: UUID
    meeting_url: str
    platform: str
    status: str
    title: str | None
    scheduled_at: datetime | None
    started_at: datetime | None
    ended_at: datetime | None
    summary: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
