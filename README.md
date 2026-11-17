# MYIDII server SDKs

| Package | |
| --- | --- |
| [`@myidii/node`](node) | Node.js: create sessions, read results, verify webhooks |

Python and PHP will follow, each released on its own.

## Working on this repo

```sh
npm install
npm run build
npx changeset        # describe your change for the changelog
```

Releases are automatic: merging the "Version packages" pull request publishes to npm with provenance.

## Testing

```sh
npm test                  # unit tests (Vitest, fetch is mocked)
npm run test:coverage     # same, with v8 coverage; fails under 95% lines
npm run test:packaging    # builds, packs and tests the tarball as published
```

The packaging tests run publint and attw on the packed tarball, then install it into throwaway projects in a temp dir: Node ESM `import`, CommonJS `require`, and TypeScript consumers with `moduleResolution` set to `node16` and `bundler`. Set `KEEP_FIXTURES=1` to keep them for a look.

Webhook signatures are checked against `node/test/fixtures/webhook-vectors.json`, made from the platform's own signing code in `platform/packages/contracts/src/signature.ts`. If that scheme ever changes, update the copy in `node/scripts/webhook-vectors.mjs` and run it to regenerate the vectors. `npm run test:vectors -w node` checks the fixture is current.

CI runs all of this on Node 20, 22 and 24 for every pull request and push to main, and the release workflow runs it again before anything is published.
