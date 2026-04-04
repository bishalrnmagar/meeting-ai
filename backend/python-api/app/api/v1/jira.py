import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.action_item import ActionItem
from app.services.jira_client import sync_action_item_to_jira

router = APIRouter(prefix="/jira", tags=["jira"])


@router.post("/sync")
async def sync_all_pending(project_key: str = "MEET", meeting_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db)):
    query = select(ActionItem).where(ActionItem.jira_sync_status == "pending")
    if meeting_id:
        query = query.where(ActionItem.meeting_id == meeting_id)

    result = await db.execute(query)
    items = result.scalars().all()

    synced = 0
    failed = 0

    for item in items:
        ticket_key = await sync_action_item_to_jira(
            project_key=project_key,
            task=item.task,
            owner=item.owner,
            due_date=str(item.due_date) if item.due_date else None,
            priority=item.priority,
        )
        if ticket_key:
            item.jira_ticket_id = ticket_key
            item.jira_sync_status = "synced"
            synced += 1
        else:
            item.jira_sync_status = "failed"
            failed += 1

    await db.commit()
    return {"synced": synced, "failed": failed, "total": len(items)}
