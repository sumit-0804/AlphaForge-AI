import json


def _parse(content: str, fallback: dict) -> dict:
    # Extract a JSON object from a (possibly fenced or chatty) LLM response.
    # Local models sometimes wrap JSON in ```fences``` or add stray text.
    # Returns `fallback` when no valid JSON object can be recovered.
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]

    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return fallback
