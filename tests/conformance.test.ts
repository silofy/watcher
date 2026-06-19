import { describe, it, expect } from "vitest";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/watcher-telemetry.schema.json";
import pluginSchema from "../schema/watcher-plugin.schema.json";
import exampleManifest from "../plugins/examples/aws-cloudshell.manifest.json";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema);
const vHandshake = ajv.getSchema(`${schema.$id}#/$defs/Handshake`)!;
const vEvent = ajv.getSchema(`${schema.$id}#/$defs/TelemetryEvent`)!;

const HANDSHAKE = {
  watcher_handshake: "1.0",
  plugin: "aws-cloudshell",
  class: "source",
  capabilities: { has_exit_codes: false, has_stdin: true, boundary_confidence: "inferred", redaction: "none" },
  context_template: "cloud:aws:cloudshell",
};

const EVENT = {
  source: "plugin",
  session_uuid: "s",
  seq: 1,
  ts_utc_us: 1718630400000000,
  kind: "command",
  payload: { cmd: "aws s3 ls", exit_code: null },
  provenance: { boundary_confidence: 0.7, redaction_method: "none", context_path: "cloud:aws:cloudshell" },
};

describe("conformance — capability handshake", () => {
  it("accepts a valid handshake", () => {
    expect(vHandshake(HANDSHAKE)).toBe(true);
  });
  it("rejects a handshake missing capabilities", () => {
    const { capabilities, ...bad } = HANDSHAKE;
    void capabilities;
    expect(vHandshake(bad)).toBe(false);
  });
  it("rejects an unknown boundary_confidence", () => {
    expect(vHandshake({ ...HANDSHAKE, capabilities: { ...HANDSHAKE.capabilities, boundary_confidence: "perfect" } })).toBe(false);
  });
  it("rejects an unknown plugin class", () => {
    expect(vHandshake({ ...HANDSHAKE, class: "magic" })).toBe(false);
  });
});

describe("conformance — telemetry envelope", () => {
  it("accepts a valid envelope", () => {
    expect(vEvent(EVENT)).toBe(true);
  });
  it("rejects an unknown kind", () => {
    expect(vEvent({ ...EVENT, kind: "screenshot" })).toBe(false);
  });
  it("rejects an unknown source", () => {
    expect(vEvent({ ...EVENT, source: "rootkit" })).toBe(false);
  });
  it("rejects an out-of-range boundary_confidence", () => {
    expect(vEvent({ ...EVENT, provenance: { boundary_confidence: 2 } })).toBe(false);
  });
  it("rejects unknown payload fields (closed schema)", () => {
    expect(vEvent({ ...EVENT, payload: { keystrokes: "secret" } })).toBe(false);
  });
  it("requires the core fields", () => {
    const { kind, ...bad } = EVENT;
    void kind;
    expect(vEvent(bad)).toBe(false);
  });
});

describe("conformance — a message is a handshake OR an envelope", () => {
  const vMessage = ajv.compile(schema);
  it("the root oneOf accepts both", () => {
    expect(vMessage(HANDSHAKE)).toBe(true);
    expect(vMessage(EVENT)).toBe(true);
  });
});

describe("conformance — plugin manifest", () => {
  const vManifest = ajv.compile(pluginSchema);
  it("the bundled aws-cloudshell example manifest is valid", () => {
    const ok = vManifest(exampleManifest);
    if (!ok) console.error(vManifest.errors);
    expect(ok).toBe(true);
  });
  it("rejects a manifest with no exec (nothing to supervise)", () => {
    const { exec, ...bad } = exampleManifest as Record<string, unknown>;
    void exec;
    expect(vManifest(bad)).toBe(false);
  });
});
