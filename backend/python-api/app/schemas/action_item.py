from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class ActionItemResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    task: str
    owner: str | None
    due_date: date | None
    priority: str
    source_sentence: str | None
    jira_ticket_id: str | None
    jira_sync_status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
