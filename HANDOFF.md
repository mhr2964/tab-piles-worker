# HANDOFF — tab-piles-worker

Cloudflare Worker for license validation, deactivation, and Pro-tier cloud sync. Talks to the Lemon Squeezy License API and stores cached validations + cloud pile state in D1.

```yaml
last-model: claude-sonnet-5
last-session: 2026-09-06
state: yellow
```

## Next action — waiting on Lemon Squeezy account review

Fully wired as of 2026-09-06: worker live at `https://tab-piles-worker.subtotal.workers.dev`, D1 migrated, real LS variant IDs in `wrangler.toml` (monthly `2095935`, yearly `2095936`, lifetime `2095937`), `LS_API_KEY` set as a Cloudflare secret (not in git). `npm run verify` confirms the worker successfully round-trips to the real Lemon Squeezy License API.

- **7-day free trial on monthly/yearly is intentional** (confirmed 2026-09-06) — not a bug, no action needed.
- **Store is in test mode because Lemon Squeezy is reviewing the account** (confirmed 2026-09-06, standard for new accounts) — no action on our end, just wait for LS to approve. Once approved, the store flips to live automatically; no code or config change needed here.

Once the store goes live: smoke test by buying your own monthly plan for real, paste the license key into the extension's Settings, confirm tier flips to Pro within 2s.

## Endpoints

| Method | Path          | Body                                | Use                                                                                  |
|--------|---------------|-------------------------------------|--------------------------------------------------------------------------------------|
| GET    | `/health`     | —                                   | Liveness                                                                             |
| POST   | `/activate`   | `{licenseKey, instanceName?}`       | First-time activation. Returns `instanceId` to store + tier                          |
| POST   | `/validate`   | `{licenseKey, instanceId}`          | Recurring validation. 24h D1 cache; cache fallback if LS unreachable                 |
| POST   | `/deactivate` | `{licenseKey, instanceId}`          | "Move my license to another machine". Clears LS instance + D1 cache                  |
| POST   | `/sync`       | `{licenseKey, instanceId, sinceMs, piles, deletions}` | Phase 5 cloud sync. LWW by `updatedAt`. Returns server-side changes since `sinceMs`. |

## Trust model

- License key alone is enough to identify a user. No accounts, no passwords.
- Each device generates its own `instanceId` (LS-issued at activation).
- D1 cache is a 24h-TTL latch over LS. If LS is down, server falls back to cached state — extension also has its own 14-day offline grace.
- `/sync` does NOT call LS on the hot path. It reads cached license state from D1. Means a recently-revoked license can still sync for up to 24h. Acceptable for v1.

## D1 schema (`migrations/0001_init.sql`)

- `validations(license_key, instance_id) PK` — one row per device per license
- `piles_cloud(license_key, pile_id) PK` — server-side pile state
- `tombstones(license_key, pile_id) PK` — deletion log so other devices learn about deletes

LWW write rule lives in the `INSERT … ON CONFLICT … WHERE excluded.updated_at > piles_cloud.updated_at` clause.

## Local development

`npm run dev` starts `wrangler dev` with the local D1. Without `.dev.vars` set, LS calls will fail — create `.dev.vars` (gitignored) with:

```
LS_API_KEY=...
```

For tests that don't hit real LS, you can stub `src/lemonsqueezy.ts` exports.

## Traps

- **`activation_limit` is set on the LS variant**, not in this code. If you forget to set it on the LS dashboard, the device cap is unlimited. Set to 5.
- **Cache poisoning.** If LS returns a bad response (e.g., 5xx with a partial body), we don't poison the cache — only successful `valid` responses overwrite cache.
- **D1 batch + ON CONFLICT.** D1 supports `batch()` of prepared statements but they execute in a single transaction. Don't mix `batch()` and `run()` for the same logical operation.
- **CORS.** Allowed origins are read from the `ALLOWED_ORIGINS` env var in `wrangler.toml` (comma-separated). Default: `chrome-extension://*,https://tabpiles.pages.dev`. **After CWS approval, replace `chrome-extension://*` with the specific published extension id** (`chrome-extension://<the-id>`) — `*` allows ANY installed extension to call the API.
- **`/sync` 402** is the standard for "Pro required" — extension should treat as "fall back to local-only mode" not as a generic error.

## Do not touch

- `.wrangler/` — local wrangler state. Always gitignored.
- `wrangler.toml`'s `database_id` after first deploy — changing it points to a different D1 and orphans all data.

---

When the worker is live, billing flow works end-to-end, and at least one Pro user has synced piles between two devices, **delete this file**.
