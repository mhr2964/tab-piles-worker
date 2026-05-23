// Post-deploy sanity check for a Tab Piles worker.
//
// Usage: node scripts/verify-deploy.mjs <https://your-worker.workers.dev>
//
// Checks:
//   1. GET /health returns { ok: true }
//   2. POST /activate with a bogus key returns 400 with an LS error message
//      (this confirms LS_API_KEY is set + the LS round-trip is wired)
//
// Also fails fast if wrangler.toml still contains the placeholder database_id
// — a deploy with the placeholder will "succeed" but every D1 query at runtime
// returns "no such database".

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wranglerPath = resolve(__dirname, '..', 'wrangler.toml')

const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/verify-deploy.mjs <https://your-worker.workers.dev>')
  process.exit(2)
}

const wrangler = readFileSync(wranglerPath, 'utf8')
if (wrangler.includes('__USER_FILL_IN_AFTER_CREATE__')) {
  console.error('✗ wrangler.toml still has the database_id placeholder. Run `npx wrangler d1 create tab-piles` and paste the returned id first.')
  process.exit(1)
}
if (wrangler.includes('__SET_AT_DEPLOY__')) {
  console.error('✗ wrangler.toml still has LS_VARIANT_* placeholders. Set them from the Lemon Squeezy dashboard before deploying.')
  process.exit(1)
}

const fails = []

console.log(`▸ GET ${target}/health`)
try {
  const r = await fetch(`${target}/health`)
  if (!r.ok) fails.push(`/health returned ${r.status}`)
  else {
    const j = await r.json()
    if (!j.ok) fails.push('/health body missing ok:true')
    else console.log('  ✓ ok')
  }
} catch (err) {
  fails.push(`/health threw: ${err.message}`)
}

console.log(`▸ POST ${target}/activate (bogus key — should return 400)`)
try {
  const r = await fetch(`${target}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey: 'TEST-INVALID-KEY-FROM-VERIFY-SCRIPT', instanceName: 'verify' }),
  })
  if (r.status === 400 || r.status === 200) {
    const j = await r.json().catch(() => ({}))
    if (j.error || j.valid === false) console.log(`  ✓ LS round-trip wired (saw: ${j.error || 'valid:false'})`)
    else fails.push(`/activate returned ${r.status} but body did not look like an LS rejection: ${JSON.stringify(j).slice(0, 100)}`)
  } else if (r.status === 502) {
    fails.push('/activate returned 502 — LS_API_KEY likely missing or invalid (run `npx wrangler secret put LS_API_KEY`)')
  } else {
    fails.push(`/activate returned unexpected ${r.status}`)
  }
} catch (err) {
  fails.push(`/activate threw: ${err.message}`)
}

if (fails.length === 0) {
  console.log('\n✓ worker is alive and LS round-trip is wired.')
  process.exit(0)
}
console.log('\n✗ verification failed:')
for (const f of fails) console.log(`  - ${f}`)
process.exit(1)
