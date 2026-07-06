# Recording web traffic with Burp Suite

The Watcher can record HTTP exchanges proxied through **Burp Suite** and grade them alongside your terminal commands on the same run timeline — the same **MITRE tactic/technique + CWE** analysis applied to web attacks as to shell commands.

Everything is **optional** and **off by default**. To enable web capture, you pass `--web` to the capture agent — and nothing is recorded until you do.

---

## What it does

When you enable `--web`, the Watcher spawns a Python bridge that polls Burp's **MCP Server** extension for proxy history. Each HTTP exchange (request + response) is streamed into the same run session as your terminal commands. The analysis layer grades each exchange deterministically:

- **MITRE ATT&CK technique** — reconnaissance, lateral movement, data exfiltration, etc.
- **CWE weakness class** — SQLi, XSS, authentication bypass, insecure deserialization, etc.
- **confidence** — weighted by payload pattern matching

Web exchanges appear in the report timeline interleaved with terminal commands, so you can see your reconnaissance, exploitation, and post-exploitation (web-side) as a unified narrative.

---

## Hard requirements

Before you can use `--web`, you need:

1. **Burp Suite** (Community or Pro — see differences below)
2. The official **MCP Server** BApp extension installed and enabled
3. **Python 3** with the bridge's dependencies

### Burp Suite: Community vs. Pro

- **Burp Community Edition:** proxy history is available via the MCP Server, but limited to a **single snapshot** (the current state of the proxy history at query time). Once history is cleared, it's gone.
- **Burp Professional:** proxy history is **persistent** across queries; the Watcher can detect new exchanges incrementally and avoid re-processing the same traffic.

Both work with the Watcher. Community users will see all current traffic when they enable `--web`; Pro users will see traffic accumulated continuously throughout the session.

### Python setup

The bridge requires Python 3.x and the `mcp` package:

```sh
pip install -r plugins/burp-bridge/requirements.txt
```

---

## Setup steps

### 1. Install and configure Burp Suite

Download Burp Suite from [PortSwigger's website](https://portswigger.net/burp) and install it. Then install and enable the **MCP Server** BApp:

- See **[PortSwigger's MCP Server documentation](https://portswigger.net/burp/documentation)** for step-by-step instructions on installing the BApp and enabling the MCP Server extension. (Search the BApp Store for "MCP Server".)
- Note the endpoint where the MCP Server listens — by default, `127.0.0.1:9876`.
- Set a **target scope** in Burp so only your target traffic is recorded. The Watcher will ingest everything in Burp's scope.

### 2. Install the bridge's Python dependencies

```sh
pip install -r plugins/burp-bridge/requirements.txt
```

This installs the `mcp` package, which the bridge uses to talk to Burp.

### 3. Run the capture agent with `--web`

Start capturing with the Watcher, adding `--web` to enable web capture:

```sh
watcher-capture --attach --platform htb --target Forge --web
```

The capture agent will spawn the bridge as a background process. As soon as Burp sees traffic from your target, the exchanges will be ingested and graded.

---

## Defaults, consent, and safety

**Nothing is captured until you pass `--web`.** The flag is the only enable mechanism.

### Scope-limited capture

The Watcher only ingests HTTP exchanges for hosts in **Burp's target scope**. If you set a scope in Burp (which you should), only traffic to those hosts is recorded.

### Web-aware redaction

Before any HTTP exchange is persisted to disk, sensitive data is **stripped automatically**:

- **Request headers:** Authorization, Cookie, X-Token, X-API-Key, and similar secrets are redacted.
- **Request body:** Credit card numbers, API keys, and common secret patterns are removed.
- **Response body:** The same redaction applies.

Secrets are **never written** to the session file — they're scrubbed on ingestion.

---

## Preflight messages — what to do if something goes wrong

When you pass `--web`, the capture agent checks whether Burp and Python are ready. You'll see one of three messages (plus one success nudge):

### "Can't reach Burp's MCP server at 127.0.0.1:9876. Is Burp running with the MCP Server extension enabled? Setup: docs/web-capture.md"

**What it means:** The bridge tried to connect to Burp's MCP Server and couldn't reach it.

**What to do:**
- Check that Burp Suite is running.
- Check that the **MCP Server** extension is installed and **enabled** in Burp (Extensions → Installed → MCP Server, toggle on).
- Check that you've noted the correct endpoint (default `127.0.0.1:9876`). If Burp is listening on a different host/port, you'll need to configure the bridge (advanced — see `plugins/burp-bridge/bridge.py` for environment variables).

### "burp-bridge needs Python 3.x and the mcp client. Install: pip install -r plugins/burp-bridge/requirements.txt"

**What it means:** The bridge is running but Python or the `mcp` package is missing.

**What to do:**
- Install Python 3 from [python.org](https://www.python.org/) if you don't have it.
- Run `pip install -r plugins/burp-bridge/requirements.txt` to install the bridge's dependencies.

### "Burp scope is empty — Watcher will ingest all proxied traffic. Set a target scope in Burp to limit what's recorded."

**What it means:** Burp's target scope is empty, so the Watcher will capture **all** traffic passing through Burp's proxy, not just your target.

**What to do:**
- This is a **nudge**, not a failure. The Watcher will still record the traffic.
- To limit recording to your target, set a scope in Burp: **Target → Scope** and add the target domain/IP.

### "Burp MCP detected; add --web to record web traffic"

**What it means:** The capture agent detected that Burp's MCP Server is running and ready. This is a convenience nudge.

**What to do:**
- You don't have to do anything. This message appears only when you're *not* already passing `--web` — if you want to enable web capture, add the flag.

---

## How to stop capturing web traffic

Type `exit` (or Ctrl+D) in the watched shell to end the session. The bridge will clean up and exit. The captured HTTP exchanges will be part of the final report.

If you want to disable web capture entirely for a run, just don't pass `--web`.
