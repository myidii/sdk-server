import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Myidii, MyidiiError, type Session, type WebhookEvent } from "../src/index.js";

type Vector = { name: string; secret: string; timestamp: number; body: string; header: string };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/webhook-vectors.json", import.meta.url), "utf8")) as { vectors: Vector[] };

const { constructEvent } = Myidii.webhooks;
const SECRET = "whsec_test_abc";
const NOW = 1_793_534_400; // seconds

/** Same algorithm the platform signs with (platform/packages/contracts/src/signature.ts). */
const sign = (body: string, secret = SECRET, t = NOW) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

const body = JSON.stringify({
  id: "evt_1", object: "event", type: "session.completed", environment: "sandbox",
  created_at: "2026-11-01T12:00:00.000Z", data: { id: "ses_1", status: "passed", score: 0.97 },
});

function expectError(fn: () => unknown, type: string, message: RegExp) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(MyidiiError);
  expect(err).toMatchObject({ type, status: 400 });
  expect((err as Error).message).toMatch(message);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("webhooks.constructEvent: valid", () => {
  it("parses a valid event from a string body", () => {
    const event = constructEvent<Pick<Session, "id" | "status" | "score">>(body, sign(body), SECRET);
    expect(event).toEqual(JSON.parse(body));
    expect(event.data.status).toBe("passed");
  });

  it("parses a valid event from a Buffer body", () => {
    const event = constructEvent(Buffer.from(body, "utf8"), sign(body), SECRET);
    expect(event.id).toBe("evt_1");
  });

  it("handles multi-byte UTF-8 the same from a Buffer and a string", () => {
    const b = JSON.stringify({ id: "evt_2", object: "event", type: "webhook.test", data: { name: "Ọ̀sárùmẹ́n café 👋" } });
    const header = sign(b);
    expect(constructEvent(b, header, SECRET)).toEqual(constructEvent(Buffer.from(b), header, SECRET));
  });

  it("tolerates spaces after commas and extra fields in the header", () => {
    const [t, v1] = sign(body).split(",");
    expect(constructEvent(body, `${t}, ${v1}, v0=ignored`, SECRET).id).toBe("evt_1");
    expect(constructEvent(body, `${v1},${t}`, SECRET).id).toBe("evt_1");
  });

  it("returns the event typed as WebhookEvent", () => {
    const event: WebhookEvent = constructEvent(body, sign(body), SECRET);
    expect(event.object).toBe("event");
  });
});

describe("webhooks.constructEvent: rejected", () => {
  it("rejects a tampered body", () => {
    const header = sign(body);
    expectError(() => constructEvent(body.replace("passed", "failed"), header, SECRET), "signature_invalid", /doesn't match/);
  });

  it("rejects a body with one extra byte", () => {
    expectError(() => constructEvent(body + " ", sign(body), SECRET), "signature_invalid", /doesn't match/);
  });

  it("rejects a re-serialised body (parsed then stringified with different spacing)", () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expectError(() => constructEvent(pretty, sign(body), SECRET), "signature_invalid", /doesn't match/);
  });

  it("rejects an already-parsed body object", () => {
    const parsed = JSON.parse(body) as unknown as string;
    expectError(() => constructEvent(parsed, sign(body), SECRET), "signature_invalid", /doesn't match/);
  });

  it("rejects the wrong secret", () => {
    expectError(() => constructEvent(body, sign(body, "whsec_other"), SECRET), "signature_invalid", /doesn't match/);
  });

  it("rejects a timestamp that was swapped after signing", () => {
    const v1 = sign(body).split(",")[1];
    expectError(() => constructEvent(body, `t=${NOW - 1},${v1}`, SECRET), "signature_invalid", /doesn't match/);
  });

  it("rejects a signature in a different case or length", () => {
    const header = sign(body);
    expectError(() => constructEvent(body, header.toUpperCase().replace("T=", "t=").replace("V1=", "v1="), SECRET), "signature_invalid", /doesn't match/);
    expectError(() => constructEvent(body, header.slice(0, -2), SECRET), "signature_invalid", /doesn't match/);
    expectError(() => constructEvent(body, `t=${NOW},v1=abc`, SECRET), "signature_invalid", /doesn't match/);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
  ])("rejects a missing header (%s)", (_label, header) => {
    expectError(() => constructEvent(body, header, SECRET), "signature_invalid", /Missing MYIDII-Signature/);
  });

  it.each([
    ["garbage", "garbage"],
    ["no v1", `t=${NOW}`],
    ["no t", "v1=abcdef"],
    ["empty v1", `t=${NOW},v1=`],
    ["non-numeric t", "t=yesterday,v1=abcdef"],
    ["zero t", "t=0,v1=abcdef"],
    ["empty t", "t=,v1=abcdef"],
    ["wrong separators", `t:${NOW};v1:abcdef`],
  ])("rejects a malformed header (%s)", (_label, header) => {
    expectError(() => constructEvent(body, header, SECRET), "signature_invalid", /Malformed/);
  });

  it("does not return an event when the signed body is not JSON", () => {
    expect(() => constructEvent("not json", sign("not json"), SECRET)).toThrow(SyntaxError);
  });
});

describe("webhooks.constructEvent: timestamp tolerance", () => {
  it("accepts exactly 300 seconds old and 300 seconds ahead", () => {
    expect(constructEvent(body, sign(body, SECRET, NOW - 300), SECRET).id).toBe("evt_1");
    expect(constructEvent(body, sign(body, SECRET, NOW + 300), SECRET).id).toBe("evt_1");
  });

  it("rejects a timestamp more than 300 seconds old", () => {
    expectError(() => constructEvent(body, sign(body, SECRET, NOW - 301), SECRET), "signature_expired", /too old/);
  });

  it("rejects a timestamp more than 300 seconds in the future", () => {
    expectError(() => constructEvent(body, sign(body, SECRET, NOW + 301), SECRET), "signature_expired", /too old/);
  });

  it("checks the age before the signature, so an old replay never verifies", () => {
    expectError(() => constructEvent(body, sign(body, "wrong", NOW - 10_000), SECRET), "signature_expired", /too old/);
  });

  it("honours a custom tolerance", () => {
    const header = sign(body, SECRET, NOW - 30);
    expect(constructEvent(body, header, SECRET, 60).id).toBe("evt_1");
    expectError(() => constructEvent(body, header, SECRET, 10), "signature_expired", /too old/);
  });

  it("with a tolerance of 0 only accepts the current second", () => {
    expect(constructEvent(body, sign(body), SECRET, 0).id).toBe("evt_1");
    expectError(() => constructEvent(body, sign(body, SECRET, NOW - 1), SECRET, 0), "signature_expired", /too old/);
  });

  it("uses the real clock", () => {
    vi.setSystemTime((NOW + 1000) * 1000);
    expectError(() => constructEvent(body, sign(body), SECRET), "signature_expired", /too old/);
    expect(constructEvent(body, sign(body, SECRET, NOW + 1000), SECRET).id).toBe("evt_1");
  });
});

describe("webhooks.constructEvent: platform test vectors", () => {
  it("has vectors to check", () => {
    expect(fixture.vectors.length).toBeGreaterThan(0);
  });

  describe.each(fixture.vectors)("$name", (v) => {
    it("matches an independent HMAC of the vector inputs", () => {
      expect(sign(v.body, v.secret, v.timestamp)).toBe(v.header);
    });

    it("verifies from a string body", () => {
      vi.setSystemTime(v.timestamp * 1000);
      expect(constructEvent(v.body, v.header, v.secret)).toEqual(JSON.parse(v.body));
    });

    it("verifies from a Buffer body", () => {
      vi.setSystemTime(v.timestamp * 1000);
      expect(constructEvent(Buffer.from(v.body, "utf8"), v.header, v.secret)).toEqual(JSON.parse(v.body));
    });

    it("fails with a different secret", () => {
      vi.setSystemTime(v.timestamp * 1000);
      expectError(() => constructEvent(v.body, v.header, v.secret + "x"), "signature_invalid", /doesn't match/);
    });

    it("expires after the tolerance", () => {
      vi.setSystemTime((v.timestamp + 301) * 1000);
      expectError(() => constructEvent(v.body, v.header, v.secret), "signature_expired", /too old/);
    });
  });
});
