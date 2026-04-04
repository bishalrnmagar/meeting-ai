import httpx

from app.config import get_settings


class JiraClient:
    def __init__(self):
        settings = get_settings()
        self.base_url = settings.jira_url.rstrip("/")
        self.auth = (settings.jira_email, settings.jira_api_token)

    async def create_issue(self, project_key: str, summary: str, description: str = "", assignee: str | None = None, due_date: str | None = None, priority: str = "Medium") -> dict:
        jira_priority_map = {"low": "Low", "medium": "Medium", "high": "High"}

        fields = {
            "project": {"key": project_key},
            "summary": summary,
            "description": description,
            "issuetype": {"name": "Task"},
            "priority": {"name": jira_priority_map.get(priority, "Medium")},
        }

        if due_date:
            fields["duedate"] = due_date
        if assignee:
            fields["assignee"] = {"name": assignee}

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/rest/api/2/issue",
                json={"fields": fields},
                auth=self.auth,
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
            return resp.json()


async def sync_action_item_to_jira(project_key: str, task: str, owner: str | None = None, due_date: str | None = None, priority: str = "medium") -> str | None:
    try:
        jira = JiraClient()
        result = await jira.create_issue(
            project_key=project_key,
            summary=task,
            assignee=owner,
            due_date=due_date,
            priority=priority,
        )
        return result.get("key")
    except Exception:
        return None
