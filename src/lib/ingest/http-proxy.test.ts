import { describe, it, expect } from "vitest";
import { harToRawCommands } from "./http-proxy";

const har = (entries: unknown[]) => JSON.stringify({ log: { version: "1.2", entries } });

const HAR = har([
  {
    startedDateTime: "2026-09-28T10:00:00.000Z",
    time: 120,
    request: { method: "POST", url: "https://target.htb/login?next=/admin", postData: { text: "user=admin&password=hunter2" } },
    response: { status: 302, content: { text: "Found. Redirecting to /admin", mimeType: "text/html" } },
  },
  {
    startedDateTime: "2026-09-28T10:00:05.000Z",
    time: 40,
    request: { method: "GET", url: "https://target.htb/admin" },
    response: { status: 200, content: { text: "PGgxPndlbGNvbWU8L2gxPg==", mimeType: "text/html", encoding: "base64" } },
  },
  // no url — skipped
  { startedDateTime: "2026-09-28T10:00:07.000Z", request: { method: "GET" } },
]);

describe("harToRawCommands", () => {
  it("maps HAR entries to web RawCommands with method + path and timing", () => {
    const raw = harToRawCommands(HAR);
    expect(raw).toHaveLength(2);
    expect(raw[0].cmd).toBe("POST /login?next=/admin");
    expect(raw[0].ended_at_ms - raw[0].started_at_ms).toBe(120);
    expect(raw[0].web?.method).toBe("POST");
    expect(raw[0].web?.status).toBe(302);
    expect(raw[1].cmd).toBe("GET /admin");
    expect(raw[1].web?.mime).toBe("text/html");
  });

  it("redacts credentials in request bodies and URLs", () => {
    const raw = harToRawCommands(HAR);
    expect(raw[0].web?.req_body).toContain("password=[redacted]");
    expect(raw[0].web?.req_body).not.toContain("hunter2");
  });

  it("decodes base64 response bodies", () => {
    const raw = harToRawCommands(HAR);
    expect(raw[1].web?.resp_body).toBe("<h1>welcome</h1>");
  });

  it("returns an empty array for non-HAR or empty input", () => {
    expect(harToRawCommands("")).toEqual([]);
    expect(harToRawCommands("{}")).toEqual([]);
    expect(harToRawCommands(har([]))).toEqual([]);
  });
});
