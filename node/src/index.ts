import { createHmac, timingSafeEqual } from "node:crypto";

// Set to the package version at build time (tsup define). Falls back when running from source, e.g. in tests.
declare const __VERSION__: string;
const USER_AGENT = `myidii-node/${typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0"}`;

// Types mirror platform/packages/contracts. Kept by hand until the SDKs are generated from it.

export type SessionStatus = "created" | "in_progress" | "passed" | "failed" | "expired";
export type Signal = { name: "head_turns" | "light_reflection" | "frame_analysis" | "device_integrity"; status: "passed" | "failed" | "not_available"; reason: string };
export type Session = {
  id: string; object: "session"; type: "liveness"; environment: "sandbox" | "live"; status: SessionStatus;
  reference: string | null; attempts: number; score: number | null; checks: Signal[] | null;
  /** Live only: set once a check passes. Fetch it with sessions.photo(id). */
  photo_url: string | null; created_at: string; decided_at: string | null;
};
export type CreatedSession = Session & { token: string; url: string; expires_at: string };
export type CreateSessionParams = {
  /** Your own id for the person, to match the result later. */
  reference?: string;
  /** Where to send the person after the scan. */
  return_url?: string;
  /** Sandbox only: force the outcome. */
  simulate?: "pass" | "fail";
};
export type Wallet = { object: "wallet"; currency: string; balance: number; price_per_session: number; sessions_left: number; low_balance: number };
export type WebhookEventType = "session.completed" | "session.expired" | "wallet.low_balance" | "wallet.topped_up" | "webhook.test";
export type WebhookEvent<T = unknown> = { id: string; object: "event"; type: WebhookEventType; environment: "sandbox" | "live"; created_at: string; data: T };

export class MyidiiError extends Error {
  constructor(message: string, public type: string, public status: number) {
    super(message);
    this.name = "MyidiiError";
  }
}

export type Options = { apiUrl?: string; timeoutMs?: number; fetch?: typeof fetch };

const DEFAULT_API = "https://api.myidii.com";

export class Myidii {
  private apiUrl: string;
  private timeoutMs: number;
  private fetch: typeof fetch;

  constructor(private secretKey: string, opts: Options = {}) {
    if (!secretKey || !secretKey.startsWith("sk_")) throw new Error("Pass your secret key (sk_test_... or sk_live_...). Never use it in a browser.");
    this.apiUrl = (opts.apiUrl ?? process.env.MYIDII_API_URL ?? DEFAULT_API).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetch = opts.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(`${this.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.secretKey}`, ...(body ? { "content-type": "application/json" } : {}), "user-agent": USER_AGENT },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { type: string; message: string } };
    if (!res.ok) throw new MyidiiError(data.error?.message ?? `Request failed with ${res.status}`, data.error?.type ?? "api_error", res.status);
    return data as T;
  }

  /** Liveness sessions. Creating one is what you pay for in live mode. */
  sessions = {
    create: (params: CreateSessionParams = {}) => this.request<CreatedSession>("POST", "/v1/sessions", { type: "liveness", ...params }),
    retrieve: (id: string) => this.request<Session>("GET", `/v1/sessions/${encodeURIComponent(id)}`),
    /** The clean still photo from a passed live check, as JPEG bytes. */
    photo: async (id: string): Promise<Uint8Array> => {
      const res = await this.fetch(`${this.apiUrl}/v1/sessions/${encodeURIComponent(id)}/photo`, {
        headers: { authorization: `Bearer ${this.secretKey}`, "user-agent": USER_AGENT }, signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { type: string; message: string } };
        throw new MyidiiError(data.error?.message ?? `Request failed with ${res.status}`, data.error?.type ?? "api_error", res.status);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
    list: (opts: { limit?: number } = {}) => this.request<{ object: "list"; data: Session[] }>("GET", `/v1/sessions${opts.limit ? `?limit=${opts.limit}` : ""}`),
  };

  wallet = {
    retrieve: () => this.request<Wallet>("GET", "/v1/wallet"),
  };

  /** Helpers for events MYIDII sends to your webhook URL. */
  static webhooks = {
    /**
     * Checks the MYIDII-Signature header against the raw request body and returns the event.
     * Pass the body exactly as received, before any JSON parsing. Throws if it doesn't match.
     */
    constructEvent<T = unknown>(rawBody: string | Buffer, signatureHeader: string | null | undefined, secret: string, toleranceSeconds = 300): WebhookEvent<T> {
      const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
      if (!signatureHeader) throw new MyidiiError("Missing MYIDII-Signature header", "signature_invalid", 400);
      const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.trim().split("=") as [string, string]));
      const t = Number(parts.t);
      if (!t || !parts.v1) throw new MyidiiError("Malformed MYIDII-Signature header", "signature_invalid", 400);
      if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) throw new MyidiiError("Signature is too old", "signature_expired", 400);
      const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
      const given = Buffer.from(parts.v1);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new MyidiiError("Signature doesn't match", "signature_invalid", 400);
      return JSON.parse(body) as WebhookEvent<T>;
    },
  };
}

export default Myidii;
