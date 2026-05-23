import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as ls from './lemonsqueezy'
import * as cache from './db'
import type { Env, SyncRequest, SyncResponse, Tier, ValidationResponse } from './types'

const app = new Hono<{ Bindings: Env }>()

// CORS — extension origins are dynamic per install ID, so we use a regex match
// rather than a single Origin allow-list.
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return null
      if (origin.startsWith('chrome-extension://')) return origin
      if (origin === 'https://tabpiles.app') return origin
      return null
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 600,
  }),
)

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

app.post('/activate', async (c) => {
  const body = await c.req
    .json<{ licenseKey?: string; instanceName?: string }>()
    .catch(() => ({}) as { licenseKey?: string; instanceName?: string })
  const licenseKey = body.licenseKey?.trim()
  const instanceName = body.instanceName?.trim() || 'tab-piles-instance'
  if (!licenseKey) return c.json({ error: 'licenseKey required' }, 400)

  const lsRes = await ls.activate(c.env, licenseKey, instanceName).catch((err: Error) => ({ error: err.message }))
  if ('error' in lsRes && lsRes.error) {
    return c.json({ valid: false, error: lsRes.error }, 400)
  }
  if (!('valid' in lsRes) || !lsRes.valid || !lsRes.instance || !lsRes.license_key) {
    return c.json({ valid: false, error: lsRes.error ?? 'activation failed' }, 400)
  }

  const tier: Tier = ls.variantToTier(lsRes.meta?.variant_id, c.env)
  const expiresAt = ls.expiresAtMs(lsRes.license_key.expires_at)
  const now = Date.now()
  await cache.upsertCache(
    c.env,
    licenseKey,
    lsRes.instance.id,
    tier,
    true,
    expiresAt,
    lsRes.meta?.variant_id ?? null,
    now,
  )

  const out: ValidationResponse = {
    valid: true,
    tier,
    expiresAt,
    instanceId: lsRes.instance.id,
    cachedAt: now,
  }
  return c.json(out)
})

app.post('/validate', async (c) => {
  const body = await c.req
    .json<{ licenseKey?: string; instanceId?: string }>()
    .catch(() => ({}) as { licenseKey?: string; instanceId?: string })
  const licenseKey = body.licenseKey?.trim()
  const instanceId = body.instanceId?.trim()
  if (!licenseKey || !instanceId) return c.json({ error: 'licenseKey + instanceId required' }, 400)

  const now = Date.now()
  const ttlMs = Number(c.env.CACHE_TTL_MS) || 24 * 60 * 60 * 1000

  // Cache check
  const cached = await cache.getCached(c.env, licenseKey, instanceId)
  if (cached && cache.isCacheFresh(cached, ttlMs, now)) {
    const out: ValidationResponse = {
      valid: cached.valid === 1,
      tier: cached.tier,
      expiresAt: cached.expires_at,
      instanceId,
      cachedAt: cached.validated_at,
    }
    return c.json(out)
  }

  // Cache miss or stale → hit LS. On LS failure, prefer falling back to cached
  // value if it exists (offline grace on the SERVER side too).
  try {
    const lsRes = await ls.validate(c.env, licenseKey, instanceId)
    const valid = lsRes.valid && lsRes.license_key?.status === 'active'
    const tier: Tier = valid ? ls.variantToTier(lsRes.meta?.variant_id, c.env) : 'free'
    const expiresAt = ls.expiresAtMs(lsRes.license_key?.expires_at)
    await cache.upsertCache(c.env, licenseKey, instanceId, tier, valid, expiresAt, lsRes.meta?.variant_id ?? null, now)

    const out: ValidationResponse = { valid, tier, expiresAt, instanceId, cachedAt: now }
    return c.json(out)
  } catch (err) {
    if (cached) {
      const out: ValidationResponse = {
        valid: cached.valid === 1,
        tier: cached.tier,
        expiresAt: cached.expires_at,
        instanceId,
        cachedAt: cached.validated_at,
      }
      return c.json(out)
    }
    return c.json({ valid: false, error: (err as Error).message }, 502)
  }
})

app.post('/deactivate', async (c) => {
  const body = await c.req
    .json<{ licenseKey?: string; instanceId?: string }>()
    .catch(() => ({}) as { licenseKey?: string; instanceId?: string })
  const licenseKey = body.licenseKey?.trim()
  const instanceId = body.instanceId?.trim()
  if (!licenseKey || !instanceId) return c.json({ error: 'licenseKey + instanceId required' }, 400)

  const lsRes = await ls.deactivate(c.env, licenseKey, instanceId).catch((err: Error) => ({ error: err.message }))
  await cache.clearCache(c.env, licenseKey, instanceId)
  if ('error' in lsRes && lsRes.error) return c.json({ ok: false, error: lsRes.error }, 502)
  return c.json({ ok: true })
})

// ───────────────────────────────────────────── Phase 5: cloud sync ──
//
// Last-write-wins by client clock. Server stores the latest version per pile and
// emits everything updated since `sinceMs` so the client can merge.
//
// Auth model: license must validate before the worker accepts sync writes. We do
// a cache-only check here (no LS round-trip on the hot path) — /validate must
// have been called at least once per device.

app.post('/sync', async (c) => {
  const body = await c.req.json<SyncRequest>().catch(() => null)
  if (!body) return c.json({ error: 'bad body' }, 400)
  const { licenseKey, instanceId, sinceMs, piles, deletions } = body
  if (!licenseKey || !instanceId) return c.json({ error: 'licenseKey + instanceId required' }, 400)

  const cached = await cache.getCached(c.env, licenseKey, instanceId)
  if (!cached || cached.valid !== 1 || cached.tier === 'free') {
    return c.json({ error: 'pro license required' }, 402)
  }
  if (cached.expires_at && Date.now() > cached.expires_at) {
    return c.json({ error: 'license expired' }, 402)
  }

  const now = Date.now()

  // Apply client uploads
  if (piles?.length) {
    const stmts = piles.map((p) =>
      c.env.DB.prepare(
        'INSERT INTO piles_cloud (license_key, pile_id, data, updated_at) ' +
          'VALUES (?1, ?2, ?3, ?4) ' +
          'ON CONFLICT(license_key, pile_id) DO UPDATE SET ' +
          '  data = excluded.data, updated_at = excluded.updated_at ' +
          'WHERE excluded.updated_at > piles_cloud.updated_at',
      ).bind(licenseKey, p.id, JSON.stringify(p.data), p.updatedAt),
    )
    await c.env.DB.batch(stmts)
  }
  if (deletions?.length) {
    const stmts: D1PreparedStatement[] = []
    for (const id of deletions) {
      stmts.push(
        c.env.DB.prepare(
          'INSERT INTO tombstones (license_key, pile_id, deleted_at) VALUES (?1, ?2, ?3) ' +
            'ON CONFLICT(license_key, pile_id) DO UPDATE SET deleted_at = excluded.deleted_at',
        ).bind(licenseKey, id, now),
      )
      stmts.push(
        c.env.DB.prepare('DELETE FROM piles_cloud WHERE license_key = ?1 AND pile_id = ?2').bind(licenseKey, id),
      )
    }
    await c.env.DB.batch(stmts)
  }

  // Read everything changed since the client's cursor
  const updatedRows = await c.env.DB.prepare(
    'SELECT pile_id, data, updated_at FROM piles_cloud WHERE license_key = ?1 AND updated_at > ?2',
  )
    .bind(licenseKey, sinceMs)
    .all<{ pile_id: number; data: string; updated_at: number }>()

  const tombstoneRows = await c.env.DB.prepare(
    'SELECT pile_id FROM tombstones WHERE license_key = ?1 AND deleted_at > ?2',
  )
    .bind(licenseKey, sinceMs)
    .all<{ pile_id: number }>()

  const out: SyncResponse = {
    serverNow: now,
    piles: (updatedRows.results ?? []).map((r) => ({
      id: r.pile_id,
      data: JSON.parse(r.data),
      updatedAt: r.updated_at,
    })),
    tombstones: (tombstoneRows.results ?? []).map((r) => r.pile_id),
  }
  return c.json(out)
})

app.notFound((c) => c.json({ error: 'not found' }, 404))
app.onError((err, c) => {
  console.error('[worker] error', err)
  return c.json({ error: err.message }, 500)
})

export default app
