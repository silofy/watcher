import { describe, it, expect } from "vitest";
import { sysmonToRawCommands } from "./sysmon";

// Shape 1: flattened (Get-WinEvent | ConvertTo-Json style)
const FLAT = JSON.stringify([
  { EventID: 1, UtcTime: "2026-09-28 14:00:00.000", CommandLine: "whoami /priv", Image: "C:\\Windows\\System32\\whoami.exe", User: "VICTIM\\jdoe", ParentImage: "C:\\Windows\\System32\\cmd.exe" },
  { EventID: 3, UtcTime: "2026-09-28 14:00:01.000", DestinationIp: "10.10.10.5" }, // network — ignored
  { EventID: 1, UtcTime: "2026-09-28 14:00:20.000", CommandLine: "mysql -u root --password=Sup3rSecret prod", Image: "C:\\Windows\\System32\\cmd.exe" },
]);

// Shape 2: raw Windows Event with EventData.Data array
const RAW = JSON.stringify([
  {
    Event: {
      System: { EventID: 1 },
      EventData: {
        Data: [
          { "@Name": "UtcTime", "#text": "2026-09-28 15:30:00.500" },
          { "@Name": "CommandLine", "#text": "powershell -enc SQBFAFgA" },
          { "@Name": "User", "#text": "CORP\\svc" },
        ],
      },
    },
  },
]);

describe("sysmonToRawCommands", () => {
  it("maps ProcessCreate (EID 1) events to RawCommands, ignoring other event IDs", () => {
    const raw = sysmonToRawCommands(FLAT);
    expect(raw).toHaveLength(2);
    expect(raw[0].cmd).toBe("whoami /priv");
    expect(raw[0].output_digest).toContain("user VICTIM\\jdoe");
    expect(raw[0].output_digest).toContain("parent");
  });

  it("parses Sysmon UtcTime as UTC and orders by time", () => {
    const raw = sysmonToRawCommands(FLAT);
    expect(raw[0].started_at_ms).toBe(Date.parse("2026-09-28T14:00:00.000Z"));
    expect(raw[1].started_at_ms).toBeGreaterThan(raw[0].started_at_ms);
    expect(raw[0].ended_at_ms).toBe(raw[0].started_at_ms); // point event
  });

  it("redacts credentials in the command line", () => {
    const raw = sysmonToRawCommands(FLAT);
    expect(raw[1].cmd).not.toContain("Sup3rSecret");
    expect(raw[1].cmd).toContain("password=[redacted]");
  });

  it("handles the nested Windows Event shape", () => {
    const raw = sysmonToRawCommands(RAW);
    expect(raw).toHaveLength(1);
    expect(raw[0].cmd).toBe("powershell -enc SQBFAFgA");
    expect(raw[0].started_at_ms).toBe(Date.parse("2026-09-28T15:30:00.500Z"));
  });

  it("accepts NDJSON and returns empty for junk", () => {
    const ndjson = '{"EventID":1,"UtcTime":"2026-09-28 16:00:00.000","CommandLine":"ipconfig /all"}\n{bad}\n';
    expect(sysmonToRawCommands(ndjson)).toHaveLength(1);
    expect(sysmonToRawCommands("")).toEqual([]);
    expect(sysmonToRawCommands("not json")).toEqual([]);
  });
});
