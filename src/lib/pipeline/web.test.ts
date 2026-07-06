import { describe, it, expect } from "vitest";
import { classifyExchange } from "./web";

describe("classifyExchange", () => {
  it("flags SQLi from a quote-tampered param + SQL error in the response", () => {
    const p = classifyExchange({
      method: "GET", url: "http://t/item?id=1'",
      status: 500, resp_body: "You have an error in your SQL syntax near",
    });
    expect(p.technique).toBe("T1190");
    expect(p.cwe).toBe("CWE-89");
  });

  it("flags path traversal from ../ in a param", () => {
    const p = classifyExchange({ method: "GET", url: "http://t/get?file=../../etc/passwd" });
    expect(p.cwe).toBe("CWE-22");
  });

  it("flags brute force on repeated auth POSTs", () => {
    const p = classifyExchange({ method: "POST", url: "http://t/login", req_body: "user=admin&pass=x" });
    expect(p.tactic).toBe("TA0001");
    expect(p.technique).toBe("T1110");
  });

  it("falls back to recon for a plain GET", () => {
    const p = classifyExchange({ method: "GET", url: "http://t/", status: 200 });
    expect(p.tactic).toBe("TA0007");
    expect(p.confidence).toBeLessThan(0.6);
  });
});
