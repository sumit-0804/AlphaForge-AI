import json


def parse_json(content: str) -> tuple[dict | None, bool]:
    # Extract a JSON object from a (possibly fenced or chatty) LLM response and
    # report whether it parsed. Returns (obj, True) on success, (None, False)
    # otherwise — the success flag is what lets the self-correction loop know it
    # needs to re-prompt.
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
    # Convenience wrapper: return the parsed object or `fallback` when no valid
    # JSON object can be recovered.
    obj, ok = parse_json(content)
    return obj if ok else fallback
