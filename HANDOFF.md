# HANDOFF — tab-piles-worker

Cloudflare Worker for license validation, deactivation, and Pro-tier cloud sync. Talks to the Lemon Squeezy License API and stores cached validations + cloud pile state in D1.

```yaml
last-model: claude-opus-4-7
last-session: 2026-05-23
state: green-pending-deploy
```

## Next action — user-blocks

1. **Install deps.** `npm install` (one-time).
2. **Create the D1 database.** `npx wrangler d1 create tab-piles` → copy the returned `database_id` into `wrangler.toml`.
3. **Run the migration (local + remote).** `npm run migrate:local` then `npm run migrate:remote` (remote requires deploy account).
4. **Lemon Squeezy.**
   - Create three products: monthly ($5/mo), yearly ($40/yr), lifetime ($79 one-time). Enable "License Keys" on each.
   - Set `activation_limit` to 5 on every variant — that's the device cap.
   - Copy the three variant IDs into `wrangler.toml` (`LS_VARIANT_MONTHLY`, `LS_VARIANT_YEARLY`, `LS_VARIANT_LIFETIME`).
   - Generate an API key (Settings → API) with read+write on licenses, then `npx wrangler secret put LS_API_KEY` and paste it.
5. **Deploy.** `npm run deploy`. Default subdomain `tab-piles-worker.<your-account>.workers.dev`. That URL is what you paste into the extension's `WORKER_URL` constant. Optional later: bind a custom subdomain via CF dashboard.
6. **Smoke.** `curl https://<worker>/health` → `{ "ok": true, ... }`. Then `curl -X POST https://<worker>/activate -H 'content-type: application/json' -d '{"licenseKey":"REAL-KEY","instanceName":"smoke"}'` with a real test purchase.

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
