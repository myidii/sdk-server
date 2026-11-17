# @myidii/node

Liveness checks from your Node.js server.

```sh
npm install @myidii/node
```

```ts
import { Myidii } from "@myidii/node";

const myidii = new Myidii(process.env.MYIDII_SECRET_KEY!);

// 1. Create a session and send the person to session.url (or pass session.url to @myidii/web).
const session = await myidii.sessions.create({ reference: "user_4821", return_url: "https://yourapp.com/after-scan" });

// 2. Read the verdict from your server. Never trust a result reported by the browser.
const result = await myidii.sessions.retrieve(session.id);
if (result.status === "passed") {
  // A real person was at the camera.
}
```

## NIN, BVN and business lookups

Nigeria only for now. The answer comes back in the response. Each field you send is compared with the official record and answered on its own: `exact`, `close` (small typos), `no`, or `not_checked`.

```ts
const nin = await myidii.identity.nin({
  nin: "00000000001",
  match: { first_name: "Adaeze", last_name: "Okafor", date_of_birth: "1990-04-02" },
  reference: "user_42",
});
if (nin.result?.found && nin.result.match?.last_name === "exact") {
  // matched
}

const bvn = await myidii.identity.bvn({ bvn: "22222222221", match: { phone: "08012345678" } });

const company = await myidii.business.lookup({ country: "NG", registration_number: "RC0000001", include_people: true });
```

Live lookups need your company to be approved under Products in the dashboard. They're charged per answer, including "not found". If the source (NIMC, NIBSS or CAC) is down you get a `MyidiiError` with `type: "source_unavailable"`, nothing is charged, and `err.lookup` holds the failed lookup.

Sandbox test numbers: NIN `00000000001` (found), `00000000002` (not found), `00000000003` (source down). BVN `22222222221`, `22222222222`, `22222222223`. Business `RC0000001` (company), `BN0000002` (business name), `RC0000002` (not found), `RC0000003` (source down).

## Webhooks

```ts
// Express: use the raw body, not the parsed JSON.
app.post("/webhooks/myidii", express.raw({ type: "application/json" }), (req, res) => {
  const event = Myidii.webhooks.constructEvent(req.body, req.header("MYIDII-Signature"), process.env.MYIDII_WEBHOOK_SECRET!);
  if (event.type === "session.completed") {
    // event.data is the session, with status, score and checks.
  }
  res.sendStatus(200);
});
```

Respond with any 2xx within 10 seconds. Failed deliveries are retried for about seven hours.

## Sandbox

Sandbox keys (`sk_test_`) are free and return simulated results. Pass `simulate: "fail"` to test a failure.
