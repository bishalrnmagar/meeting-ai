import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.transcript_line import TranscriptLine
from app.schemas.transcript import TranscriptLineResponse, TranscriptResponse

router = APIRouter(prefix="/transcripts", tags=["transcripts"])


@router.get("/{meeting_id}", response_model=TranscriptResponse)
async def get_transcript(meeting_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TranscriptLine)
        .where(TranscriptLine.meeting_id == meeting_id)
        .order_by(TranscriptLine.start_time)
    )
    lines = result.scalars().all()
    return TranscriptResponse(
        meeting_id=meeting_id,
        lines=[TranscriptLineResponse.model_validate(line) for line in lines],
        total=len(lines),
    )
