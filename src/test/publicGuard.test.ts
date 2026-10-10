import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { clientIp, createRateLimiter, isSameSite } from "../../server/publicGuard";

const req = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: "10.0.0.1" } }) as unknown as IncomingMessage;

describe("public endpoint guard (Gemini quota / Yahoo proxy)", () => {
  it("accepts only this site's own pages", () => {
    expect(isSameSite(req({ host: "kod.onrender.com", origin: "https://kod.onrender.com" }))).toBe(true);
    expect(isSameSite(req({ host: "kod.onrender.com", referer: "https://kod.onrender.com/setups" }))).toBe(true);
    expect(isSameSite(req({ host: "kod.onrender.com", origin: "https://evil.com" }))).toBe(false);
    expect(isSameSite(req({ host: "kod.onrender.com" }))).toBe(false);
  });

  it("limits each key per window and resets after it", () => {
    const allow = createRateLimiter(2, 1000);
    expect([allow("a", 0), allow("a", 1), allow("a", 2)]).toEqual([true, true, false]);
    expect(allow("b", 2)).toBe(true);
    expect(allow("a", 1001)).toBe(true);
  });

  it("uses the first forwarded IP behind Render's proxy", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.1.1.1" }))).toBe("1.2.3.4");
    expect(clientIp(req({}))).toBe("10.0.0.1");
  });
});
