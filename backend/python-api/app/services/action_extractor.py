import json

from openai import AsyncOpenAI

from app.config import get_settings

SYSTEM_PROMPT = """You extract action items from meeting transcripts.

For each action item, return a JSON object with:
- task: what needs to be done
- owner: who is responsible (email or name, null if not mentioned)
- due_date: deadline in YYYY-MM-DD format (null if not mentioned)
- priority: "low", "medium", or "high" based on urgency language
- source_sentence: the exact sentence from the transcript

Rules:
- Only extract explicit commitments or assignments
- Never hallucinate tasks not discussed
- If no owner is mentioned, set owner to null
- If no due date is mentioned, set due_date to null

Return a JSON array of action items. If none found, return [].

Example input:
"Alice said she will fix the login validation by Friday. We also need to update the docs."

Example output:
[
  {"task": "Fix login page validation", "owner": "Alice", "due_date": null, "priority": "high", "source_sentence": "Alice said she will fix the login validation by Friday"},
  {"task": "Update the docs", "owner": null, "due_date": null, "priority": "medium", "source_sentence": "We also need to update the docs"}
]"""


async def extract_action_items(transcript_text: str) -> list[dict]:
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Extract action items from this transcript:\n\n{transcript_text}"},
        ],
        temperature=0.1,
        max_tokens=2000,
        response_format={"type": "json_object"},
    )

    content = response.choices[0].message.content
    parsed = json.loads(content)

    # Handle both {"action_items": [...]} and [...] formats
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        for key in ("action_items", "items", "tasks"):
            if key in parsed and isinstance(parsed[key], list):
                return parsed[key]
    return []
