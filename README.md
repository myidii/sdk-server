# MYIDII Server SDKs

Node, Python and PHP. Generated from `platform/packages/contracts`.

Used on the developer's server to create sessions, fetch results and verify webhooks with the secret key.

```ts
const session = await myidii.sessions.create({ type: "liveness" });
const check = await myidii.sessions.get(session.id);
```
