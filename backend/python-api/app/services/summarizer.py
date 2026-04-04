from openai import AsyncOpenAI

from app.config import get_settings

SYSTEM_PROMPT = """You are a meeting summarizer. Given a meeting transcript, produce:
1. An executive summary (3-5 sentences)
2. Key decisions made
3. Open questions

Be concise and factual. Do not add information not present in the transcript."""

CHUNK_SIZE = 12000  # ~15 min of transcript at avg speaking rate


async def summarize_transcript(transcript_text: str) -> str:
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    chunks = _chunk_transcript(transcript_text)

    if len(chunks) == 1:
        return await _summarize_single(client, chunks[0])

    # For long meetings: summarize chunks then merge
    chunk_summaries = []
    for chunk in chunks:
        summary = await _summarize_single(client, chunk)
        chunk_summaries.append(summary)

    merged = "\n\n---\n\n".join(chunk_summaries)
    return await _merge_summaries(client, merged)


async def _summarize_single(client: AsyncOpenAI, text: str) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Summarize this meeting transcript:\n\n{text}"},
        ],
        temperature=0.3,
        max_tokens=1000,
    )
    return response.choices[0].message.content


async def _merge_summaries(client: AsyncOpenAI, summaries_text: str) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You merge multiple meeting segment summaries into one coherent executive summary. Remove redundancy. Be concise."},
            {"role": "user", "content": f"Merge these segment summaries into one final summary:\n\n{summaries_text}"},
        ],
        temperature=0.3,
        max_tokens=1500,
    )
    return response.choices[0].message.content


def _chunk_transcript(text: str) -> list[str]:
    words = text.split()
    chunks = []
    for i in range(0, len(words), CHUNK_SIZE):
        chunks.append(" ".join(words[i : i + CHUNK_SIZE]))
    return chunks if chunks else [text]
