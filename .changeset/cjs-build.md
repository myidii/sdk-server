---
"@myidii/node": patch
---

Ship a CommonJS build next to the ESM one, so `require("@myidii/node")` works on every supported Node version. Imports and types are unchanged.

The user-agent now carries the real package version, and the minimum Node version is 20, matching what's tested.
