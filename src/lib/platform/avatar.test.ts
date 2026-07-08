import { describe, it, expect, vi } from "vitest";
import { resolveAvatar } from "./avatar";

describe("resolveAvatar", () => {
  it("returns null (hue fallback) with no creds and no fetch", async () => {
    expect(await resolveAvatar({ platform: "htb", name: "Abducted" })).toBeNull();
  });
  it("resolves an HTB avatar URL from the profile API when a token is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ info: { avatar: "/storage/avatars/x.png" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const url = await resolveAvatar({ platform: "htb", name: "Abducted" }, { htbToken: "t" });
    expect(url).toContain("/storage/avatars/x.png");
    vi.unstubAllGlobals();
  });
  it("returns null on fetch failure (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await resolveAvatar({ platform: "htb", name: "Abducted" }, { htbToken: "t" })).toBeNull();
    vi.unstubAllGlobals();
  });
});
