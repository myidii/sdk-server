// Pasted into the ESM and CJS fixtures by test-packaging.mjs after their own imports, which provide
// assert, createHmac, readFileSync, Myidii, MyidiiError and Default.
async function smoke() {
  assert.equal(typeof Myidii, "function", "Myidii is exported");
  assert.equal(typeof MyidiiError, "function", "MyidiiError is exported");
  assert.equal(Default, Myidii, "default export is Myidii");
  assert.throws(() => new Myidii("pk_test_123"), /secret key/);

  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/wallet")) return new Response(JSON.stringify({ object: "wallet", balance: 5 }), { status: 200 });
    if (url.endsWith("/photo")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    return new Response(JSON.stringify({ error: { type: "not_found", message: "No such session" } }), { status: 404 });
  };
  const client = new Myidii("sk_test_123", { apiUrl: "https://api.example.test/", fetch });

  const wallet = await client.wallet.retrieve();
  assert.equal(wallet.balance, 5);
  assert.equal(calls[0].url, "https://api.example.test/v1/wallet");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer sk_test_123");

  const photo = await client.sessions.photo("ses_1");
  assert.ok(photo instanceof Uint8Array);
  assert.deepEqual(Array.from(photo), [1, 2, 3]);

  await assert.rejects(client.sessions.retrieve("missing"), (err) => {
    assert.ok(err instanceof MyidiiError);
    assert.equal(err.name, "MyidiiError");
    assert.equal(err.status, 404);
    assert.equal(err.type, "not_found");
    return true;
  });

  const secret = "whsec_test_smoke";
  const body = JSON.stringify({ id: "evt_1", object: "event", type: "webhook.test", data: {} });
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  assert.equal(Myidii.webhooks.constructEvent(Buffer.from(body), header, secret).id, "evt_1");
  assert.throws(() => Myidii.webhooks.constructEvent(body, header, "wrong"), MyidiiError);

  // The committed platform vectors must verify through the packed build too. They are old, so
  // widen the tolerance; expiry itself is covered by the unit tests.
  const { vectors } = JSON.parse(readFileSync(process.argv[2], "utf8"));
  for (const v of vectors) Myidii.webhooks.constructEvent(v.body, v.header, v.secret, 1e12);

  console.log("smoke ok");
}
