import { describe, expect, it } from 'vitest'
import { isCacheFresh } from './db'
import type { ValidationRecord } from './types'

function rec(over: Partial<ValidationRecord>): ValidationRecord {
  return {
    license_key: 'KEY',
    instance_id: 'INST',
    tier: 'monthly',
    valid: 1,
    expires_at: null,
    validated_at: 0,
    variant_id: null,
    ...over,
  }
}

describe('isCacheFresh', () => {
  const TTL = 24 * 60 * 60 * 1000

  it('fresh when (now - validated_at) < ttl', () => {
    const now = 1_000_000_000
    expect(isCacheFresh(rec({ validated_at: now - 1000 }), TTL, now)).toBe(true)
  })

  it('stale at exactly the ttl boundary (strict-less-than semantics)', () => {
    const now = 1_000_000_000
    expect(isCacheFresh(rec({ validated_at: now - TTL }), TTL, now)).toBe(false)
  })

  it('stale when older than ttl', () => {
    const now = 1_000_000_000
    expect(isCacheFresh(rec({ validated_at: now - TTL - 1 }), TTL, now)).toBe(false)
  })
})
