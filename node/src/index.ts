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
export type Wallet = {
  object: "wallet";
  /** Always "USD". */
  currency: string;
  /** In cents. */
  balance: number;
  /** In cents. One live session covers up to 3 tries. */
  price_per_session: number;
  sessions_left: number;
  /** In cents. Below this, wallet.low_balance is sent. */
  low_balance: number;
  /** The currency top-ups are paid in, from the company's country. */
  pay_currency: string;
  /** Units of pay_currency per dollar. */
  fx_rate: number;
  /** "demo" while payments aren't connected. */
  provider: "paystack" | "demo";
};
export type MatchLevel = "exact" | "close" | "no" | "not_checked";
/** The details to compare with the official record. Send what you have; each field is answered on its own. */
export type IdentityMatch = {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  /** YYYY-MM-DD. */
  date_of_birth?: string;
  phone?: string;
};
/** ISO 3166-1 alpha-2 country code. Only "NG" for now; coverage.retrieve() lists what's supported. */
export type Country = "NG";
export type IdentityIdType = "nin" | "bvn";
export type IdentityLookupParams = {
  country: Country;
  /** For NG: "nin" or "bvn". */
  id_type: IdentityIdType;
  /** For NG, NIN and BVN are 11 digits. */
  id_number: string;
  match?: IdentityMatch;
  reference?: string;
};
export type BusinessLookupParams = {
  country: Country;
  /** RC, BN or IT number, for example "RC1234567". */
  registration_number: string;
  /** Directors and shareholders too. */
  include_people?: boolean;
  reference?: string;
};
export type IdentityLookupResult = {
  found: boolean;
  /** Null when nothing was found. */
  match: { first_name: MatchLevel; middle_name: MatchLevel; last_name: MatchLevel; date_of_birth: MatchLevel; phone: MatchLevel } | null;
  /** Only for companies approved for full records. The photo is base64 JPEG. */
  record?: { first_name?: string; middle_name?: string; last_name?: string; date_of_birth?: string; gender?: "male" | "female"; phone?: string; photo?: string } | null;
};
export type BusinessLookupResult = {
  found: boolean;
  company: {
    name: string;
    registration_number: string;
    kind: "company" | "business_name" | "incorporated_trustees";
    status: string | null;
    registered_on: string | null;
    address: string | null;
    email: string | null;
    people: { name: string; role: string; shares?: number }[] | null;
  } | null;
};
export type LookupType = IdentityIdType | "business";
export type LookupProduct = "identity" | "business";
export type Lookup<R = IdentityLookupResult | BusinessLookupResult> = {
  id: string;
  object: "lookup";
  /** ISO 3166-1 alpha-2, for example "NG". */
  country: string;
  product: LookupProduct;
  type: LookupType;
  environment: "sandbox" | "live";
  status: "completed" | "failed";
  reference: string | null;
  /** The last 4 digits of the number looked up. */
  subject_last4: string;
  result: R | null;
  /** Set when status is failed. Failed lookups aren't charged. */
  error: { type: string; message: string } | null;
  created_at: string;
};

export type CoverageIdType = { id_type: string; label: string; name: string; hint: string; live: boolean };
export type CoverageIdentityCountry = { country: string; name: string; id_types: CoverageIdType[] };
export type CoverageBusinessCountry = { country: string; name: string; registry: string; number_label: string; hint: string; live: boolean };
/** Which countries and ID types you can check. live is false until your company is approved for live lookups. */
export type Coverage = { object: "coverage"; identity: CoverageIdentityCountry[]; business: CoverageBusinessCountry[] };

export type WebhookEventType = "session.completed" | "session.expired" | "lookup.completed" | "wallet.low_balance" | "wallet.topped_up" | "webhook.test";
export type WebhookEvent<T = unknown> = { id: string; object: "event"; type: WebhookEventType; environment: "sandbox" | "live"; created_at: string; data: T };

export class MyidiiError extends Error {
  constructor(message: string, public type: string, public status: number, public lookup: Lookup | null = null) {
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
    const data = (await res.json().catch(() => ({}))) as { error?: { type: string; message: string }; lookup?: Lookup };
    if (!res.ok) throw new MyidiiError(data.error?.message ?? `Request failed with ${res.status}`, data.error?.type ?? "api_error", res.status, data.lookup ?? null);
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

  /**
   * ID number check: look up a government ID number in a supported country. The answer comes back in the response.
   * Live lookups need your company to be approved under Products in the dashboard, and are charged per answer,
   * including "not found". Sandbox test numbers for NG: NIN 00000000001 (found), 00000000002 (not found),
   * 00000000003 (source down); BVN 22222222221, 22222222222, 22222222223.
   */
  identity = {
    lookup: (params: IdentityLookupParams) => this.request<Lookup<IdentityLookupResult>>("POST", "/v1/identity/lookup", params),
  };

  /** Company registry check. Sandbox (NG): RC0000001, BN0000002, RC0000002 (not found), RC0000003 (source down). */
  business = {
    lookup: (params: BusinessLookupParams) => this.request<Lookup<BusinessLookupResult>>("POST", "/v1/business/lookup", params),
  };

  /** Past ID number and company registry lookups. */
  lookups = {
    retrieve: (id: string) => this.request<Lookup>("GET", `/v1/lookups/${encodeURIComponent(id)}`),
    list: (opts: { limit?: number; type?: LookupType; country?: string } = {}) => {
      const q = new URLSearchParams();
      if (opts.limit) q.set("limit", String(opts.limit));
      if (opts.type) q.set("type", opts.type);
      if (opts.country) q.set("country", opts.country);
      const qs = q.toString();
      return this.request<{ object: "list"; data: Lookup[] }>("GET", `/v1/lookups${qs ? `?${qs}` : ""}`);
    },
  };

  /** Supported countries and ID types, and whether each is live for your company. */
  coverage = {
    retrieve: () => this.request<Coverage>("GET", "/v1/coverage"),
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
