import { describe, it, expect, vi } from "vitest";
import { resolveAvatar } from "./avatar";
import * as net from "../net";

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
  it("resolves a THM room avatar via the native fetch seam's og:image meta tag", async () => {
    const spy = vi
      .spyOn(net, "fetchWriteupUrl")
      .mockResolvedValue('<html><head><meta property="og:image" content="https://cdn.tryhackme.com/room.png"></head></html>');
    const url = await resolveAvatar({ platform: "thm", name: "RootMe", url: "https://tryhackme.com/room/rootme" });
    expect(url).toBe("https://cdn.tryhackme.com/room.png");
    expect(spy).toHaveBeenCalledWith("https://tryhackme.com/room/rootme");
    spy.mockRestore();
  });
  it("returns null when the THM page has no og:image (non-ok / empty response)", async () => {
    const spy = vi.spyOn(net, "fetchWriteupUrl").mockResolvedValue("");
    const url = await resolveAvatar({ platform: "thm", name: "RootMe", url: "https://tryhackme.com/room/rootme" });
    expect(url).toBeNull();
    spy.mockRestore();
  });
});
