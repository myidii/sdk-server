# @myidii/node

## 0.1.1

### Patch Changes

- [`6b402ec`](https://github.com/myidii/sdk-server/commit/6b402ec9e6be9d127d2d4c2fab74a729f18c48e3) Thanks [@Scottlexium](https://github.com/Scottlexium)! - Ship a CommonJS build next to the ESM one, so `require("@myidii/node")` works on every supported Node version. Imports and types are unchanged.

  The user-agent now carries the real package version, and the minimum Node version is 20, matching what's tested.

- [`9286e89`](https://github.com/myidii/sdk-server/commit/9286e89c26d45c28b25ce247d4bab30baed64e7d) Thanks [@Scottlexium](https://github.com/Scottlexium)! - `Wallet` now includes `pay_currency`, `fx_rate` and `provider`, which the API already returns.
