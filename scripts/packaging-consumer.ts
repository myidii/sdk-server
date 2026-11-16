// Typechecked by test-packaging.mjs as an ESM file (.mts / bundler) and a CommonJS file (.cts).
// Never run; it only has to compile against the published types.
import Default, {
  Myidii, MyidiiError,
  type CreateSessionParams, type CreatedSession, type Options, type Session, type SessionStatus,
  type Signal, type Wallet, type WebhookEvent, type WebhookEventType,
} from "@myidii/node";

const options: Options = { apiUrl: "https://api.myidii.com", timeoutMs: 5_000, fetch: globalThis.fetch };
const client: Myidii = new Myidii("sk_test_123", options);
const SameClass: typeof Myidii = Default;
void SameClass;

export async function consumer(rawBody: Buffer, signature: string | undefined): Promise<void> {
  const params: CreateSessionParams = { reference: "user_1", return_url: "https://app.example/done", simulate: "pass" };
  const created: CreatedSession = await client.sessions.create(params);
  const url: string = created.url;
  const session: Session = await client.sessions.retrieve(created.id);
  const status: SessionStatus = session.status;
  const checks: Signal[] | null = session.checks;
  const listed: Session[] = (await client.sessions.list({ limit: 10 })).data;
  const photo: Uint8Array = await client.sessions.photo(session.id);
  const wallet: Wallet = await client.wallet.retrieve();

  const event: WebhookEvent<Session> = Myidii.webhooks.constructEvent<Session>(rawBody, signature, "whsec_x");
  const fromString: WebhookEvent = Myidii.webhooks.constructEvent("{}", null, "whsec_x", 60);
  const type: WebhookEventType = event.type;
  const score: number | null = event.data.score;

  // The types are real, not any.
  // @ts-expect-error simulate only accepts "pass" or "fail"
  await client.sessions.create({ simulate: "maybe" });
  // @ts-expect-error status is a union of known states
  const notAStatus: SessionStatus = "approved";
  // @ts-expect-error retrieve needs an id
  await client.sessions.retrieve();
  // @ts-expect-error the key is required
  new Myidii();

  try {
    await client.wallet.retrieve();
  } catch (err) {
    if (err instanceof MyidiiError) {
      const errorType: string = err.type;
      const httpStatus: number = err.status;
      const message: string = err.message;
      void [errorType, httpStatus, message];
    }
  }

  void [url, status, checks, listed, photo, wallet, fromString, type, score, notAStatus];
}
