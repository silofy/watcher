# Open plugin API (§5.4)

You can't write a wrapper for every niche environment (AWS/Azure CloudShell, `kubectl exec`, Podman,
LXC, custom distros), so the contract is published instead: **a plugin is any process that emits
valid messages to the daemon's local socket.** Newline-delimited JSON; a leading **capability
handshake**, then **§3.3 TelemetryEvents**.

## Robustness (the four guarantees, brief §5.4)

1. **Capability handshake** — the plugin declares `has_exit_codes`, `has_stdin`, `boundary_confidence`,
   `redaction`, so the core knows the fidelity it's ingesting and fills what the plugin can't provide
   (`daemon: apply_capabilities`).
2. **Mandatory re-scan on receipt** — the daemon re-redacts every event regardless of the declared
   `redaction`; the privacy guarantee lives in the core, never in the plugin.
3. **Versioned JSON-Schema + conformance kit** — `schema/watcher-telemetry.schema.json` plus
   `npm run conformance <stream.ndjson>` (and the `tests/conformance.test.ts` suite) so contributors
   self-validate before a PR.
4. **Plugin manifest** — `schema/watcher-plugin.schema.json`: the daemon launches `exec` as a
   supervised, least-privilege, token-gated child (see `examples/aws-cloudshell.manifest.json`).

## Plugin classes

| Class | Job | Example |
|---|---|---|
| `source` | emit telemetry from a new environment | CloudShell tap, `kubectl exec` shim |
| `context_resolver` | map environment identity into the context stack | "this prompt = pod web-7f in ns prod" |
| `transform` | custom redaction / enrichment | distro-specific secret patterns |

## Thin SDK (~50 lines)

`sdk/watcher_sdk.py` handles the handshake + envelope framing. Go and Rust SDKs follow the same shape.

```bash
# 1) run the daemon as a socket service
watcher-daemon --listen 127.0.0.1:8799 --db engagement.db --key <k>
# 2) run a plugin against it
python plugins/examples/cloudshell_plugin.py 8799
# 3) self-validate a plugin's output before a PR
npm run conformance my-plugin-output.ndjson
```
