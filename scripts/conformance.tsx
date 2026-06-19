/**
 * Plugin conformance checker (brief §5.4). A contributor runs this against their plugin's output
 * to self-validate BEFORE opening a PR: the first message must be a capability Handshake, the rest
 * must be valid §3.3 TelemetryEvents, per schema/watcher-telemetry.schema.json.
 *
 *   vite-node scripts/conformance.tsx [path-to-plugin-stream.ndjson]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/watcher-telemetry.schema.json";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema);
const vHandshake = ajv.getSchema(`${schema.$id}#/$defs/Handshake`)!;
const vEvent = ajv.getSchema(`${schema.$id}#/$defs/TelemetryEvent`)!;

const file = resolve(process.argv[2] ?? "plugins/examples/sample-stream.ndjson");
const lines = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((l, i) => ({ i: i + 1, l: l.trim() }))
  .filter((x) => x.l.length > 0);

const errors: string[] = [];
lines.forEach(({ i, l }, idx) => {
  let msg: unknown;
  try {
    msg = JSON.parse(l);
  } catch {
    errors.push(`line ${i}: not valid JSON`);
    return;
  }
  const validate = idx === 0 ? vHandshake : vEvent;
  const what = idx === 0 ? "handshake" : "envelope";
  if (!validate(msg)) {
    const detail = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    errors.push(`line ${i} (${what}): ${detail}`);
  }
});

/* eslint-disable no-console */
if (errors.length === 0) {
  console.log(`✓ conformant: ${file}`);
  console.log(`  1 handshake + ${lines.length - 1} envelope(s) valid against watcher-telemetry v1.0`);
} else {
  console.error(`✗ non-conformant: ${file}`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
