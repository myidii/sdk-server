# @myidii/node

## 0.2.0

### Minor Changes

- [#2](https://github.com/myidii/sdk-server/pull/2) [`f9fbb66`](https://github.com/myidii/sdk-server/commit/f9fbb66beb7365e67234adf928bbe377eac1ae93) Thanks [@Scottlexium](https://github.com/Scottlexium)! - Add ID number and company registry checks: `identity.lookup()` (NIN and BVN in Nigeria for now), `business.lookup()`, `coverage.retrieve()` for the supported countries, and `lookups.retrieve()` / `lookups.list()` with `type` and `country` filters. Lookups carry `country` and `product`. `MyidiiError` now carries the failed `lookup` when a source is down, and `lookup.completed` is a webhook event type.

## 0.1.1

### Patch Changes

- [`6b402ec`](https://github.com/myidii/sdk-server/commit/6b402ec9e6be9d127d2d4c2fab74a729f18c48e3) Thanks [@Scottlexium](https://github.com/Scottlexium)! - Ship a CommonJS build next to the ESM one, so `require("@myidii/node")` works on every supported Node version. Imports and types are unchanged.

  The user-agent now carries the real package version, and the minimum Node version is 20, matching what's tested.

- [`9286e89`](https://github.com/myidii/sdk-server/commit/9286e89c26d45c28b25ce247d4bab30baed64e7d) Thanks [@Scottlexium](https://github.com/Scottlexium)! - `Wallet` now includes `pay_currency`, `fx_rate` and `provider`, which the API already returns.
