import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Default, { Myidii, MyidiiError } from "../src/index.js";

const KEY = "sk_test_123";

type Call = { url: string; init: RequestInit };

/** A fetch stand-in that records every call and answers with whatever the test queued. */
function fakeFetch(...responses: Array<Response | (() => Response)>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("fakeFetch: no response queued");
    return typeof next === "function" ? next() : next;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const session = {
  id: "ses_1", object: "session", type: "liveness", environment: "sandbox", status: "created",
  reference: null, attempts: 0, score: null, checks: null, photo_url: null,
  created_at: "2026-01-01T00:00:00Z", decided_at: null,
};

function headersOf(call: Call) {
  return new Headers(call.init.headers);
}

beforeEach(() => {
  vi.stubEnv("MYIDII_API_URL", undefined as unknown as string);
});

describe("exports", () => {
  it("exports Myidii as named and default export", () => {
    expect(Default).toBe(Myidii);
  });

  it("MyidiiError carries type, status and message", () => {
    const err = new MyidiiError("nope", "invalid_request", 422);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MyidiiError");
    expect(err.message).toBe("nope");
    expect(err.type).toBe("invalid_request");
    expect(err.status).toBe(422);
  });
});

describe("constructor", () => {
  it.each([
    ["empty", ""],
    ["publishable test key", "pk_test_123"],
    ["publishable live key", "pk_live_123"],
    ["random string", "hello"],
    ["sk without underscore", "sktest"],
    ["leading space", " sk_test_123"],
  ])("rejects %s", (_label, key) => {
    expect(() => new Myidii(key)).toThrow(/secret key/);
  });

  it("rejects undefined at runtime", () => {
    expect(() => new Myidii(undefined as unknown as string)).toThrow(/secret key/);
  });

  it.each(["sk_test_123", "sk_live_abc"])("accepts %s", (key) => {
    expect(() => new Myidii(key)).not.toThrow();
  });
});

describe("base URL", () => {
  async function urlFor(opts: ConstructorParameters<typeof Myidii>[1]) {
    const f = fakeFetch(json({ object: "wallet" }));
    await new Myidii(KEY, { ...opts, fetch: f.fetch }).wallet.retrieve();
    return f.calls[0]!.url;
  }

  it("defaults to https://api.myidii.com", async () => {
    expect(await urlFor({})).toBe("https://api.myidii.com/v1/wallet");
  });

  it("reads MYIDII_API_URL", async () => {
    vi.stubEnv("MYIDII_API_URL", "http://localhost:4000");
    expect(await urlFor({})).toBe("http://localhost:4000/v1/wallet");
  });

  it("prefers the apiUrl option over MYIDII_API_URL", async () => {
    vi.stubEnv("MYIDII_API_URL", "http://env.example");
    expect(await urlFor({ apiUrl: "https://opt.example" })).toBe("https://opt.example/v1/wallet");
  });

  it("strips a trailing slash from the option", async () => {
    expect(await urlFor({ apiUrl: "https://opt.example/" })).toBe("https://opt.example/v1/wallet");
  });

  it("strips a trailing slash from MYIDII_API_URL", async () => {
    vi.stubEnv("MYIDII_API_URL", "http://localhost:4000/");
    expect(await urlFor({})).toBe("http://localhost:4000/v1/wallet");
  });

  it("keeps a path prefix", async () => {
    expect(await urlFor({ apiUrl: "https://gw.example/myidii/" })).toBe("https://gw.example/myidii/v1/wallet");
  });
});

describe("default fetch", () => {
  it("uses the global fetch when none is passed", async () => {
    const f = fakeFetch(json({ object: "wallet", balance: 1 }));
    vi.stubGlobal("fetch", f.fetch);
    const wallet = await new Myidii(KEY).wallet.retrieve();
    expect(wallet.balance).toBe(1);
    expect(f.calls).toHaveLength(1);
  });
});

describe("request headers", () => {
  it("sends Bearer auth and the user agent on JSON requests", async () => {
    const f = fakeFetch(json(session));
    await new Myidii(KEY, { fetch: f.fetch }).sessions.retrieve("ses_1");
    const h = headersOf(f.calls[0]!);
    expect(h.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(h.get("user-agent")).toMatch(/^myidii-node\/\d+\.\d+\.\d+/);
    expect(h.get("content-type")).toBeNull();
    expect(f.calls[0]!.init.body).toBeUndefined();
    expect(f.calls[0]!.init.method).toBe("GET");
  });

  it("sends Bearer auth and the user agent on photo requests", async () => {
    const f = fakeFetch(new Response(new Uint8Array([1])));
    await new Myidii(KEY, { fetch: f.fetch }).sessions.photo("ses_1");
    const h = headersOf(f.calls[0]!);
    expect(h.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(h.get("user-agent")).toMatch(/^myidii-node\/\d+\.\d+\.\d+/);
  });

  it("attaches an AbortSignal to every request", async () => {
    const f = fakeFetch(json(session), new Response(new Uint8Array([1])));
    const client = new Myidii(KEY, { fetch: f.fetch });
    await client.sessions.retrieve("a");
    await client.sessions.photo("a");
    for (const c of f.calls) expect(c.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("sessions.create", () => {
  it("POSTs {type: liveness, ...params} as JSON", async () => {
    const created = { ...session, token: "tok", url: "https://verify.myidii.com/s/tok", expires_at: "x" };
    const f = fakeFetch(json(created, 201));
    const res = await new Myidii(KEY, { fetch: f.fetch }).sessions.create({
      reference: "user_1", return_url: "https://app.example/done", simulate: "fail",
    });
    const call = f.calls[0]!;
    expect(call.url).toBe("https://api.myidii.com/v1/sessions");
    expect(call.init.method).toBe("POST");
    expect(headersOf(call).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(call.init.body))).toEqual({
      type: "liveness", reference: "user_1", return_url: "https://app.example/done", simulate: "fail",
    });
    expect(res).toEqual(created);
  });

  it("sends just the type with no params", async () => {
    const f = fakeFetch(json(session));
    await new Myidii(KEY, { fetch: f.fetch }).sessions.create();
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ type: "liveness" });
  });
});

describe("sessions.retrieve", () => {
  it("GETs /v1/sessions/:id and returns the body", async () => {
    const f = fakeFetch(json(session));
    const res = await new Myidii(KEY, { fetch: f.fetch }).sessions.retrieve("ses_1");
    expect(f.calls[0]!.url).toBe("https://api.myidii.com/v1/sessions/ses_1");
    expect(res).toEqual(session);
  });

  it("URL-encodes the id", async () => {
    const f = fakeFetch(json(session));
    await new Myidii(KEY, { fetch: f.fetch }).sessions.retrieve("../wallet?x=1#y z");
    expect(f.calls[0]!.url).toBe("https://api.myidii.com/v1/sessions/..%2Fwallet%3Fx%3D1%23y%20z");
  });
});

describe("sessions.list", () => {
  it("GETs /v1/sessions without a query by default", async () => {
    const f = fakeFetch(json({ object: "list", data: [session] }));
    const res = await new Myidii(KEY, { fetch: f.fetch }).sessions.list();
    expect(f.calls[0]!.url).toBe("https://api.myidii.com/v1/sessions");
    expect(res.data).toHaveLength(1);
  });

  it("passes limit as a query parameter", async () => {
    const f = fakeFetch(json({ object: "list", data: [] }));
    await new Myidii(KEY, { fetch: f.fetch }).sessions.list({ limit: 25 });
    expect(f.calls[0]!.url).toBe("https://api.myidii.com/v1/sessions?limit=25");
  });
});

describe("sessions.photo", () => {
  it("GETs /v1/sessions/:id/photo and returns a Uint8Array", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2]);
    const f = fakeFetch(new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
    const res = await new Myidii(KEY, { fetch: f.fetch }).sessions.photo("ses_1");
    expect(f.calls[0]!.url).toBe("https://api.myidii.com/v1/sessions/ses_1/photo");
    expect(res).toBeInstanceOf(Uint8Array);
    expect(Array.from(res)).toEqual(Array.from(bytes));
  });

  it("URL-encodes the id", async () => {
    const f = fakeFetch(new Response(new Uint8Array()));
    await new Myidii(KEY, { fetch: f.fetch }).sessions.photo("a/b");
    expect(f.calls[0]!.url).toBe("https://api.myidii.com/v1/sessions/a%2Fb/photo");
  });

  it("turns a JSON error into MyidiiError", async () => {
    const f = fakeFetch(json({ error: { type: "not_found", message: "No photo for this session" } }, 404));
    const err = await new Myidii(KEY, { fetch: f.fetch }).sessions.photo("x").catch((e) => e);
    expect(err).toBeInstanceOf(MyidiiError);
    expect(err).toMatchObject({ type: "not_found", status: 404, message: "No photo for this session" });
  });

  it("turns a non-JSON error into MyidiiError", async () => {
    const f = fakeFetch(new Response("Bad Gateway", { status: 502 }));
    const err = await new Myidii(KEY, { fetch: f.fetch }).sessions.photo("x").catch((e) => e);
    expect(err).toBeInstanceOf(MyidiiError);
    expect(err).toMatchObject({ type: "api_error", status: 502, message: "Request failed with 502" });
  });
});

describe("wallet.retrieve", () => {
  it("GETs /v1/wallet", async () => {
    const wallet = { object: "wallet", currency: "usd", balance: 1000, price_per_session: 10, sessions_left: 100, low_balance: 200 };
    const f = fakeFetch(json(wallet));
    expect(await new Myidii(KEY, { fetch: f.fetch }).wallet.retrieve()).toEqual(wallet);
    expect(f.calls[0]!.url).toBe("https://api.myidii.com/v1/wallet");
  });
});

describe("error responses", () => {
  const call = (res: Response) =>
    new Myidii(KEY, { fetch: fakeFetch(res).fetch }).sessions.retrieve("x").catch((e: unknown) => e);

  it("uses the API error type and message", async () => {
    const err = await call(json({ error: { type: "authentication_error", message: "Invalid secret key" } }, 401));
    expect(err).toBeInstanceOf(MyidiiError);
    expect(err).toMatchObject({ name: "MyidiiError", type: "authentication_error", status: 401, message: "Invalid secret key" });
  });

  it("falls back when the body is not JSON", async () => {
    const err = await call(new Response("<html>oops</html>", { status: 500, headers: { "content-type": "text/html" } }));
    expect(err).toBeInstanceOf(MyidiiError);
    expect(err).toMatchObject({ type: "api_error", status: 500, message: "Request failed with 500" });
  });

  it("falls back when the body is empty", async () => {
    const err = await call(new Response(null, { status: 503 }));
    expect(err).toMatchObject({ type: "api_error", status: 503, message: "Request failed with 503" });
  });

  it("falls back when the JSON has no error object", async () => {
    const err = await call(json({ message: "something else" }, 400));
    expect(err).toMatchObject({ type: "api_error", status: 400, message: "Request failed with 400" });
  });

  it("falls back per field when the error object is partial", async () => {
    const err = await call(json({ error: { message: "Only a message" } }, 409));
    expect(err).toMatchObject({ type: "api_error", status: 409, message: "Only a message" });
    const err2 = await call(json({ error: { type: "rate_limited" } }, 429));
    expect(err2).toMatchObject({ type: "rate_limited", status: 429, message: "Request failed with 429" });
  });

  it("errors on POST as well", async () => {
    const f = fakeFetch(json({ error: { type: "insufficient_funds", message: "Top up your wallet" } }, 402));
    const err = await new Myidii(KEY, { fetch: f.fetch }).sessions.create().catch((e) => e);
    expect(err).toMatchObject({ type: "insufficient_funds", status: 402 });
  });

  it("propagates network errors from fetch unchanged", async () => {
    const boom = new TypeError("fetch failed");
    const f = vi.fn(async () => { throw boom; }) as unknown as typeof fetch;
    await expect(new Myidii(KEY, { fetch: f }).wallet.retrieve()).rejects.toBe(boom);
  });
});

describe("timeout", () => {
  /** Never answers on its own; rejects when the signal aborts, like real fetch. */
  const hangingFetch = (seen: AbortSignal[] = []) =>
    ((_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal!;
        seen.push(signal);
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })) as unknown as typeof fetch;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts a JSON request after timeoutMs", async () => {
    const seen: AbortSignal[] = [];
    const start = Date.now();
    const err = await new Myidii(KEY, { fetch: hangingFetch(seen), timeoutMs: 50 }).wallet.retrieve().catch((e) => e);
    expect(Date.now() - start).toBeLessThan(5_000);
    expect(seen[0]!.aborted).toBe(true);
    expect((err as Error).name).toBe("TimeoutError");
  });

  it("aborts a photo request after timeoutMs", async () => {
    const err = await new Myidii(KEY, { fetch: hangingFetch(), timeoutMs: 50 }).sessions.photo("x").catch((e) => e);
    expect((err as Error).name).toBe("TimeoutError");
  });

  it("defaults to 15 seconds", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const f = fakeFetch(json({}), new Response(new Uint8Array()));
    const client = new Myidii(KEY, { fetch: f.fetch });
    await client.wallet.retrieve();
    await client.sessions.photo("x");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 15_000);
    expect(spy).toHaveBeenNthCalledWith(2, 15_000);
  });

  it("uses a fresh signal per request", async () => {
    const f = fakeFetch(json({}), json({}));
    const client = new Myidii(KEY, { fetch: f.fetch, timeoutMs: 1_000 });
    await client.wallet.retrieve();
    await client.wallet.retrieve();
    expect(f.calls[0]!.init.signal).not.toBe(f.calls[1]!.init.signal);
  });
});

const lookup = {
  id: "lkp_1", object: "lookup", country: "NG", product: "identity", type: "nin", environment: "sandbox", status: "completed", reference: "user_1", subject_last4: "0001",
  result: { found: true, match: { first_name: "exact", middle_name: "not_checked", last_name: "close", date_of_birth: "exact", phone: "not_checked" } },
  error: null, created_at: "2026-11-17T10:00:00Z",
};

describe("identity.lookup", () => {
  it("posts a NIN lookup with match details", async () => {
    const { fetch, calls } = fakeFetch(json(lookup));
    const params = { country: "NG", id_type: "nin", id_number: "00000000001", match: { first_name: "Adaeze", date_of_birth: "1990-04-02" }, reference: "user_1" } as const;
    const out = await new Myidii(KEY, { fetch, apiUrl: "https://api.test" }).identity.lookup(params);
    expect(out.result?.match?.last_name).toBe("close");
    expect(out.country).toBe("NG");
    expect(out.product).toBe("identity");
    expect(calls[0]!.url).toBe("https://api.test/v1/identity/lookup");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(params);
    expect(headersOf(calls[0]!).get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("posts a BVN lookup to the same endpoint", async () => {
    const { fetch, calls } = fakeFetch(json({ ...lookup, type: "bvn" }));
    await new Myidii(KEY, { fetch, apiUrl: "https://api.test" }).identity.lookup({ country: "NG", id_type: "bvn", id_number: "22222222221" });
    expect(calls[0]!.url).toBe("https://api.test/v1/identity/lookup");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ country: "NG", id_type: "bvn", id_number: "22222222221" });
  });

  it("hands back the failed lookup when the source is down", async () => {
    const failed = { ...lookup, status: "failed", result: null, error: { type: "source_unavailable", message: "NIMC isn't answering" } };
    const { fetch } = fakeFetch(json({ error: { type: "source_unavailable", message: "NIMC isn't answering right now." }, lookup: failed }, 503));
    const err = await new Myidii(KEY, { fetch, apiUrl: "https://api.test" }).identity.lookup({ country: "NG", id_type: "nin", id_number: "00000000003" }).catch((e) => e);
    expect(err).toBeInstanceOf(MyidiiError);
    expect(err).toMatchObject({ type: "source_unavailable", status: 503, lookup: { id: "lkp_1", status: "failed" } });
  });

  it("leaves lookup null on other errors", async () => {
    const { fetch } = fakeFetch(json({ error: { type: "product_not_approved", message: "Not approved" } }, 403));
    const err = await new Myidii(KEY, { fetch, apiUrl: "https://api.test" }).identity.lookup({ country: "NG", id_type: "bvn", id_number: "22222222221" }).catch((e) => e);
    expect(err).toMatchObject({ type: "product_not_approved", status: 403, lookup: null });
  });
});

describe("business.lookup", () => {
  it("posts the registration number", async () => {
    const { fetch, calls } = fakeFetch(json({ ...lookup, product: "business", type: "business", result: { found: true, company: { name: "Sandbox Foods Limited" } } }));
    const out = await new Myidii(KEY, { fetch, apiUrl: "https://api.test" }).business.lookup({ country: "NG", registration_number: "RC0000001", include_people: true });
    expect(out.result?.company?.name).toBe("Sandbox Foods Limited");
    expect(out.product).toBe("business");
    expect(calls[0]!.url).toBe("https://api.test/v1/business/lookup");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ country: "NG", registration_number: "RC0000001", include_people: true });
  });
});

describe("coverage.retrieve", () => {
  it("gets the supported countries", async () => {
    const coverage = {
      object: "coverage",
      identity: [{ country: "NG", name: "Nigeria", id_types: [
        { id_type: "nin", label: "NIN", name: "National Identification Number", hint: "11 digits", live: true },
        { id_type: "bvn", label: "BVN", name: "Bank Verification Number", hint: "11 digits", live: false },
      ] }],
      business: [{ country: "NG", name: "Nigeria", registry: "CAC", number_label: "RC or BN number", hint: "RC1234567", live: false }],
    };
    const { fetch, calls } = fakeFetch(json(coverage));
    const out = await new Myidii(KEY, { fetch, apiUrl: "https://api.test" }).coverage.retrieve();
    expect(calls[0]!.url).toBe("https://api.test/v1/coverage");
    expect(calls[0]!.init.method).toBe("GET");
    expect(out.identity[0]!.id_types.map((t) => t.id_type)).toEqual(["nin", "bvn"]);
    expect(out.business[0]!.registry).toBe("CAC");
  });
});

describe("lookups", () => {
  it("retrieves one, escaping the id", async () => {
    const { fetch, calls } = fakeFetch(json(lookup));
    await new Myidii(KEY, { fetch, apiUrl: "https://api.test" }).lookups.retrieve("lkp/1");
    expect(calls[0]!.url).toBe("https://api.test/v1/lookups/lkp%2F1");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("lists with optional filters", async () => {
    const { fetch, calls } = fakeFetch(json({ object: "list", data: [lookup] }), json({ object: "list", data: [] }), json({ object: "list", data: [] }));
    const c = new Myidii(KEY, { fetch, apiUrl: "https://api.test" });
    expect((await c.lookups.list({ limit: 5, type: "bvn" })).data).toHaveLength(1);
    await c.lookups.list();
    await c.lookups.list({ country: "NG", type: "nin" });
    expect(calls[0]!.url).toBe("https://api.test/v1/lookups?limit=5&type=bvn");
    expect(calls[1]!.url).toBe("https://api.test/v1/lookups");
    expect(calls[2]!.url).toBe("https://api.test/v1/lookups?type=nin&country=NG");
  });
});
