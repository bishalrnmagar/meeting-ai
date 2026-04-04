import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.action_item import ActionItem
from app.schemas.action_item import ActionItemResponse
from app.services.jira_client import sync_action_item_to_jira

router = APIRouter(prefix="/action-items", tags=["action-items"])


@router.get("/{meeting_id}", response_model=list[ActionItemResponse])
async def get_action_items(meeting_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ActionItem)
        .where(ActionItem.meeting_id == meeting_id)
        .order_by(ActionItem.created_at)
    )
    return list(result.scalars().all())


@router.post("/{action_item_id}/sync-jira", response_model=ActionItemResponse)
async def sync_to_jira(action_item_id: uuid.UUID, project_key: str = "MEET", db: AsyncSession = Depends(get_db)):
    item = await db.get(ActionItem, action_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Action item not found")

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
    else:
        item.jira_sync_status = "failed"

    await db.commit()
    await db.refresh(item)
    return item
