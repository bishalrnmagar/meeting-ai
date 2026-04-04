"""
Post-meeting worker: listens for meeting.ended events on Redis Streams,
then generates summary + extracts action items.
"""
import asyncio
import json
import uuid

from sqlalchemy import select

from app.config import get_settings
from app.core.database import async_session
from app.core.redis_client import get_redis
from app.models.action_item import ActionItem
from app.models.meeting import Meeting
from app.models.transcript_line import TranscriptLine
from app.services.action_extractor import extract_action_items
from app.services.summarizer import summarize_transcript

STREAM_KEY = "meeting:events"
GROUP_NAME = "post-meeting-workers"
CONSUMER_NAME = "worker-1"


async def ensure_consumer_group(r):
    try:
        await r.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
    except Exception:
        pass  # Group already exists


async def process_meeting_ended(meeting_id: uuid.UUID):
    async with async_session() as db:
        # Fetch transcript lines
        result = await db.execute(
            select(TranscriptLine)
            .where(TranscriptLine.meeting_id == meeting_id)
            .order_by(TranscriptLine.start_time)
        )
        lines = result.scalars().all()

        if not lines:
            return

        # Build transcript text
        transcript_text = "\n".join(
            f"[{line.speaker or 'Unknown'}]: {line.content}" for line in lines
        )

        # Generate summary and extract action items in parallel
        summary, action_items_data = await asyncio.gather(
            summarize_transcript(transcript_text),
            extract_action_items(transcript_text),
        )

        # Update meeting with summary
        meeting = await db.get(Meeting, meeting_id)
        if meeting:
            meeting.summary = summary

        # Store action items
        for item_data in action_items_data:
            action_item = ActionItem(
                meeting_id=meeting_id,
                task=item_data["task"],
                owner=item_data.get("owner"),
                due_date=item_data.get("due_date"),
                priority=item_data.get("priority", "medium"),
                source_sentence=item_data.get("source_sentence"),
            )
            db.add(action_item)

        await db.commit()


async def run_worker():
    r = await get_redis()
    await ensure_consumer_group(r)

    print(f"[Worker] Listening on stream '{STREAM_KEY}'...")

    while True:
        try:
            messages = await r.xreadgroup(
                GROUP_NAME, CONSUMER_NAME, {STREAM_KEY: ">"}, count=1, block=5000
            )

            for stream, entries in messages:
                for msg_id, data in entries:
                    event_type = data.get("event")
                    if event_type == "meeting.ended":
                        meeting_id = uuid.UUID(data["meeting_id"])
                        print(f"[Worker] Processing meeting {meeting_id}...")
                        await process_meeting_ended(meeting_id)
                        await r.xack(STREAM_KEY, GROUP_NAME, msg_id)
                        print(f"[Worker] Done processing {meeting_id}")

        except Exception as e:
            print(f"[Worker] Error: {e}")
            await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(run_worker())
