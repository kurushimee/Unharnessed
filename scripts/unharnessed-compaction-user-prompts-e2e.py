#!/usr/bin/env python3
"""End-to-end check that the user's prompts survive compaction verbatim and
in order. Real binary, a local fake Anthropic Messages API (no network).

usage: scripts/unharnessed-compaction-user-prompts-e2e.py <out-dir>

Each turn is its own resumed process (`-c`), so every compaction after the
first one works on a windowed load of the session, like a real resume.

Ways it can fail, each checked below:
1. a prompt the compaction summarized away is missing from the next
   request (the summary is all the model gets);
2. a prompt comes back altered (newlines, markup, quotes, unicode) or out
   of order;
3. a second compaction, in a new process, drops the prompts the first one
   recorded;
4. a prompt still in the kept tail is listed again, so it appears twice;
5. harness text (`/compact`, harness notices, the summarizer's own
   instructions) is listed as if the user wrote it;
6. a compaction entry written by an older build (no list on it) breaks the
   context instead of falling back to the summary alone.

Writes <out-dir>/<step>.out (the command run, then its json-mode stdout),
<step>.err, and <step>-requests.json for every run (UNHARNESSED_BIN picks
the binary, default target/release/unharnessed). Exits non-zero when a
check fails.
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = str(Path(os.environ.get("UNHARNESSED_BIN", ROOT / "target/release/unharnessed")).resolve())
OUT = Path(sys.argv[1]).resolve()
HOME = OUT / "home"
HOME.mkdir(parents=True, exist_ok=True)
BASE_ENV = {k: v for k, v in os.environ.items() if not k.startswith(("UNHARNESSED_", "UH_", "XDG_"))}
BASE_ENV.update(HOME=str(HOME), USERPROFILE=str(HOME), UNHARNESSED_OFFLINE="1", DO_NOT_TRACK="1",
                UV_CACHE_DIR=os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache/uv")),
                UNHARNESSED_PACKAGE_DIR=str(ROOT), UNHARNESSED_KERNEL_VENV=str(OUT / "kernel-venv"))
FAILED = []
REQUESTS = []
SUMMARY = "E2E_SUMMARY_9b1e: the user asked for some things."

# Prompts as a user writes them: several lines, markdown, markup-looking
# text, quotes, unicode, and one long paste.
PROMPTS = [
    "P1_a3f0 Build the parser.\n  Constraint: never touch `src/legacy/`.\n\n- keep <tags> & \"quotes\"",
    "P2_71c4 Also: the output must be CSV, not JSON. Ünïcödé ✓",
    "P3_e95d Here is the log:\n" + "\n".join(f"line {i}: value={i * 7}" for i in range(150)),
    "P4_0d2b Wait, use tabs\tnot spaces in the CSV.",
    "P5_c8a7 Status?",
]


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f" ({detail})"), flush=True)
    if not ok:
        FAILED.append(name)


def last_text(body):
    return json.dumps(body["messages"][-1])


class Provider(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        REQUESTS.append(body)
        text = "A model answer long enough to fill the kept tail. " * 4
        if "<conversation>" in last_text(body):
            text = SUMMARY
        events = [
            ("message_start", {"type": "message_start", "message": {
                "id": f"msg_{len(REQUESTS)}", "type": "message", "role": "assistant", "content": [],
                "model": "e2e-model", "stop_reason": None, "usage": {"input_tokens": 100, "output_tokens": 1}}}),
            ("content_block_start", {"type": "content_block_start", "index": 0,
                                     "content_block": {"type": "text", "text": ""}}),
            ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                     "delta": {"type": "text_delta", "text": text}}),
            ("content_block_stop", {"type": "content_block_stop", "index": 0}),
            ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"},
                               "usage": {"output_tokens": 10}}),
            ("message_stop", {"type": "message_stop"}),
        ]
        wire = "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("request-id", f"req_e2e_{len(REQUESTS)}")
        self.send_header("Content-Length", str(len(wire)))
        self.end_headers()
        self.wfile.write(wire)

    def log_message(self, *args):
        pass


SERVER = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
threading.Thread(target=SERVER.serve_forever, daemon=True).start()


def setup(name, keep_recent_tokens):
    work = OUT / name
    agent = work / "agent"
    agent.mkdir(parents=True, exist_ok=True)
    model = {"id": "e2e-model", "name": "E2E", "reasoning": False, "input": ["text"], "contextWindow": 128000,
             "maxTokens": 4096, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}}
    (agent / "models.json").write_text(json.dumps({"providers": {"e2e": {
        "api": "anthropic-messages", "baseUrl": f"http://127.0.0.1:{SERVER.server_port}",
        "apiKey": "e2e-local-dummy", "models": [model]}}}))
    (agent / "settings.json").write_text(json.dumps({"compaction": {"keepRecentTokens": keep_recent_tokens}}))
    return work


def run(work, label, prompt, resume=True):
    """One `-p --mode json` process; returns (exit code, its requests)."""
    env = dict(BASE_ENV, UNHARNESSED_AGENT_DIR=str(work / "agent"), UNHARNESSED_CODING_AGENT_DIR=str(work / "agent"))
    args = [BIN, "-p", "--mode", "json", "--model", "e2e/e2e-model", "--session-dir", str(work / "sessions")]
    if resume:
        args.append("-c")
    args.append(prompt)
    start = len(REQUESTS)
    result = subprocess.run(args, cwd=work, env=env, text=True, encoding="utf-8", capture_output=True,
                            timeout=300, stdin=subprocess.DEVNULL)
    shown = " ".join(json.dumps(a) if (" " in a or "\n" in a) else a for a in args)
    (OUT / f"{label}.out").write_text(f"$ {shown}\n# exit {result.returncode}\n{result.stdout}", encoding="utf-8")
    (OUT / f"{label}.err").write_text(result.stderr, encoding="utf-8")
    (OUT / f"{label}-requests.json").write_text(json.dumps(REQUESTS[start:], indent=1, ensure_ascii=False),
                                               encoding="utf-8")
    return result.returncode, REQUESTS[start:]


def session_file(work):
    [session] = (work / "sessions").glob("*.jsonl")
    return session


def entries(work):
    return [json.loads(line) for line in session_file(work).read_text(encoding="utf-8").splitlines() if line.strip()]


def compactions(work):
    return [e for e in entries(work) if e.get("type") == "compaction"]


def request_texts(body):
    """Every text block of a request's messages, in order."""
    texts = []
    for message in body["messages"]:
        content = message["content"]
        if isinstance(content, str):
            texts.append(content)
            continue
        for block in content:
            if block.get("type") == "text":
                texts.append(block["text"])
            elif block.get("type") == "tool_result":
                inner = block.get("content")
                texts.extend([inner] if isinstance(inner, str) else [b.get("text", "") for b in inner or []])
    return texts


def check_turn_request(case, label, body, typed):
    """The model's request for a turn holds every prompt typed so far, each
    exactly once, verbatim, in the order it was typed."""
    joined = "\n".join(request_texts(body))
    counts = {p[:7]: joined.count(p) for p in typed}
    check(f"{case}/{label}: every prompt typed so far is in the request, verbatim (1, 2)",
          all(counts.values()), {k: v for k, v in counts.items() if not v})
    check(f"{case}/{label}: no prompt appears twice (4)",
          all(v <= 1 for v in counts.values()), {k: v for k, v in counts.items() if v > 1})
    positions = [joined.find(p) for p in typed]
    check(f"{case}/{label}: the prompts are in the order they were typed (2)",
          all(x >= 0 for x in positions) and positions == sorted(positions), positions)
    listed = joined.split("<user-prompts>", 1)[1].split("</user-prompts>", 1)[0] if "<user-prompts>" in joined else ""
    leaked = [t for t in ("/compact", "[python-state]", "<conversation>", "PREFIX of a turn") if t in listed]
    check(f"{case}/{label}: no harness text is listed as a user prompt (5)", not leaked, leaked)
    check(f"{case}/{label}: the summary is still there", SUMMARY in joined, joined[:300])


def scenario(case, keep_recent_tokens):
    work = setup(case, keep_recent_tokens)
    typed = []

    def turn(index, resume=True):
        typed.append(PROMPTS[index])
        code, requests = run(work, f"{case}-turn{index + 1}", PROMPTS[index], resume=resume)
        check(f"{case}: turn {index + 1} exits 0", code == 0 and requests, code)
        return requests[0] if requests else {"messages": []}

    turn(0, resume=False)
    turn(1)
    code, _ = run(work, f"{case}-compact1", "/compact")
    check(f"{case}: first /compact exits 0 with one compaction", code == 0 and len(compactions(work)) == 1,
          (code, len(compactions(work))))
    check_turn_request(case, "after the first compaction", turn(2), typed)
    turn(3)
    code, _ = run(work, f"{case}-compact2", "/compact")
    check(f"{case}: second /compact exits 0 (3)", code == 0 and len(compactions(work)) == 2,
          (code, len(compactions(work))))
    check_turn_request(case, "after the second compaction, in a new process (3)", turn(4), typed)
    return work


# The cut inside the last turn (its prompt is summarized away), then a cut
# that keeps the last turn whole (its prompt stays a retained message).
scenario("split", 10)
work = scenario("whole-turn", 60)

# 6. A compaction entry from an older build: no list on it.
lines = session_file(work).read_text(encoding="utf-8").splitlines()
for i, line in enumerate(lines):
    entry = json.loads(line) if line.strip() else None
    if entry and entry.get("type") == "compaction":
        (entry.get("details") or {}).pop("userPrompts", None)
        lines[i] = json.dumps(entry, ensure_ascii=False)
session_file(work).write_text("\n".join(lines) + "\n", encoding="utf-8")
code, requests = run(work, "old-entry-turn", "P6_44e1 continue")
joined = "\n".join(request_texts(requests[0])) if requests else ""
check("old entry: the turn exits 0 with the summary and no prompt list (6)",
      code == 0 and SUMMARY in joined and "<user-prompts>" not in joined, (code, joined[:300]))

SERVER.shutdown()
print(f"\n{len(FAILED)} failed" if FAILED else "\nall passed")
sys.exit(1 if FAILED else 0)
