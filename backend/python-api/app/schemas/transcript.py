from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class TranscriptLineResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    speaker: str | None
    content: str
    start_time: float
    end_time: float | None
    confidence: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TranscriptResponse(BaseModel):
    meeting_id: UUID
    lines: list[TranscriptLineResponse]
    total: int
