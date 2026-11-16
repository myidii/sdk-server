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
