import { describe, it, expect } from "vitest";
import { parseThmTasks, thmAdapter } from "./thm";

const ROOM = `Task 1  Recon
Scan the machine with nmap. What port is open?
Task 2  Gaining Access
Exploit the SMB service to get a shell.
Task 3  Privilege Escalation
Escalate to SYSTEM and read root.txt.`;

describe("parseThmTasks", () => {
  it("turns a THM task list into a linear objective tree", () => {
    const tree = parseThmTasks(ROOM);
    expect(tree.length).toBe(3);
    expect(tree[0].objective).toMatch(/recon/);
    expect(tree[1].depends_on).toEqual([tree[0].objective]);
    expect(tree[2].depends_on).toEqual([tree[1].objective]);
  });
  it("returns [] for text that isn't a THM task list", () => {
    expect(parseThmTasks("just some prose about hacking")).toEqual([]);
  });
});

describe("thmAdapter.intendedPath", () => {
  it("returns the parsed tree for THM task text", async () => {
    const tree = await thmAdapter.intendedPath!({ target: { platform: "thm", kind: "room", name: "Blue" }, raw: ROOM });
    expect(tree && tree.length).toBe(3);
  });
  it("returns null when there is no room structure to parse", async () => {
    expect(await thmAdapter.intendedPath!({ target: { platform: "thm", kind: "room", name: "Blue" }, raw: "prose" })).toBeNull();
  });
});
