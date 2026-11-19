---
"@myidii/node": minor
---

Add ID number and company registry checks: `identity.lookup()` (NIN and BVN in Nigeria for now), `business.lookup()`, `coverage.retrieve()` for the supported countries, and `lookups.retrieve()` / `lookups.list()` with `type` and `country` filters. Lookups carry `country` and `product`. `MyidiiError` now carries the failed `lookup` when a source is down, and `lookup.completed` is a webhook event type.
