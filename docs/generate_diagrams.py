"""Regenerate the workflow diagrams from the compiled LangGraph graphs.

Run from the backend directory so `app.*` imports resolve:

    cd backend
    .\\.venv\\Scripts\\python.exe ..\\docs\\generate_diagrams.py

Rendering PNGs uses `draw_mermaid_png()`, which calls the mermaid.ink web
service unless `pyppeteer` is installed locally. Pass --mmd-only to skip the
network call and refresh just the text sources.
"""

import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
# Running `python ..\docs\generate_diagrams.py` puts docs/ on sys.path rather
# than the cwd, so `app` would not resolve. Add backend/ explicitly to make the
# script runnable from anywhere.
BACKEND = DOCS.parent / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


# Hand-authored diagrams. Unlike the graph exports below these are NOT derived
# from code, so they can drift — update system.mmd when the architecture changes.
HAND_AUTHORED = (
    "system",
    "agent-research",
    "agent-scanner",
    "agent-advisor",
    "agent-reflection",
    "agent-narrators",
)


def render_via_mermaid_ink(mermaid_syntax: str) -> bytes:
    """Render mermaid text to PNG bytes via mermaid.ink.

    Deliberately NOT using langchain_core's draw_mermaid_png for hand-authored
    diagrams: it encodes the payload with base64.b64encode rather than
    urlsafe_b64encode, so any diagram whose encoding happens to contain "/"
    produces mermaid.ink/img/<part>/<part> and 404s. The failure looks random
    because it depends purely on the byte content of the diagram.
    """
    import base64
    import urllib.request

    encoded = base64.urlsafe_b64encode(mermaid_syntax.encode("utf-8")).decode("ascii")
    url = f"https://mermaid.ink/img/{encoded}?type=png&bgColor=white"
    # mermaid.ink 403s urllib's default User-Agent.
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise RuntimeError(f"mermaid.ink returned {resp.status}")
        return resp.read()


def main() -> int:
    from app.agents.debate_agent import _debate_graph
    from app.graph.workflow import workflow

    mmd_only = "--mmd-only" in sys.argv

    # Generated from the compiled graphs — these cannot drift from the code.
    for name, compiled in (("mermaid", workflow), ("debate-subgraph", _debate_graph)):
        graph = compiled.get_graph()
        (DOCS / f"{name}.mmd").write_text(graph.draw_mermaid(), encoding="utf-8")
        print(f"wrote {name}.mmd")
        if mmd_only:
            continue
        png = graph.draw_mermaid_png()
        (DOCS / f"{name}.png").write_bytes(png)
        print(f"wrote {name}.png ({len(png):,} bytes)")

    if mmd_only:
        return 0

    for name in HAND_AUTHORED:
        src = DOCS / f"{name}.mmd"
        if not src.exists():
            print(f"skipped {name}.mmd (missing)")
            continue
        png = render_via_mermaid_ink(src.read_text(encoding="utf-8"))
        (DOCS / f"{name}.png").write_bytes(png)
        print(f"wrote {name}.png ({len(png):,} bytes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
