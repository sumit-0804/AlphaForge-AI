import json


def parse_json(content: str) -> tuple[dict | None, bool]:
    # Pull a JSON object out of an LLM reply; returns (obj, True) or (None, False).
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]

    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]

    try:
        return json.loads(text), True
    except json.JSONDecodeError:
        return None, False


def _parse(content: str, fallback: dict) -> dict:
    # Return the parsed object, or the fallback if it didn't parse.
    obj, ok = parse_json(content)
    return obj if ok else fallback
