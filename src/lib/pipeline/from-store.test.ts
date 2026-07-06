import { describe, it, expect } from "vitest";
import { parseEnvelopes, envelopesToRawCommands } from "./ingest";
import { runPipeline } from "./index";

describe("store-exported stream grades to episodes", () => {
  it("produces a web episode with CWE from an exported NDJSON", () => {
    // Shape emitted by `watcher-store --export`: a command + an http exchange pair.
    const nd = [
      `{"source":"local_pty","session_uuid":"s1","seq":1,"ts_utc_us":100,"kind":"command","payload":{"cmd":"nmap -sV t"},"provenance":{"platform":"htb"}}`,
      `{"source":"plugin","session_uuid":"s1","seq":0,"ts_utc_us":200,"kind":"http_request","payload":{"method":"GET","url":"http://t/item?id=1'","pair_id":"p1"},"provenance":{"context_path":"web:burp"}}`,
      `{"source":"plugin","session_uuid":"s1","seq":0,"ts_utc_us":250,"kind":"http_response","payload":{"status":500,"resp_body":"SQL syntax error","pair_id":"p1"}}`,
    ].join("\n");
    const raw = envelopesToRawCommands(parseEnvelopes(nd));
    const { episodes } = runPipeline(raw, { golden: [] });
    const web = episodes.find((e) => e.context_path === "web:burp");
    expect(web).toBeDefined();
    expect(web!.frameworks?.cwe).toContain("CWE-89");
  });
});
