---
"@myidii/node": minor
---

Add NIN, BVN and business lookups: `identity.nin()`, `identity.bvn()`, `business.lookup()`, and `lookups.retrieve()` / `lookups.list()`. `MyidiiError` now carries the failed `lookup` when a source is down, and `lookup.completed` is a webhook event type.
