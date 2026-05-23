import { describe, expect, it } from 'vitest'
import { expiresAtMs, variantToTier } from './lemonsqueezy'
import type { Env } from './types'

const env = {
  LS_VARIANT_MONTHLY: 'var-monthly-123',
  LS_VARIANT_YEARLY: 'var-yearly-456',
  LS_VARIANT_LIFETIME: 'var-lifetime-789',
} as Env

describe('variantToTier', () => {
  it('maps known variant IDs to their tiers', () => {
    expect(variantToTier('var-monthly-123', env)).toBe('monthly')
    expect(variantToTier('var-yearly-456', env)).toBe('yearly')
    expect(variantToTier('var-lifetime-789', env)).toBe('lifetime')
  })

  it('returns free for unknown / undefined / empty variants', () => {
    expect(variantToTier(undefined, env)).toBe('free')
    expect(variantToTier('', env)).toBe('free')
    expect(variantToTier('var-some-other-product', env)).toBe('free')
  })
})

describe('expiresAtMs', () => {
  it('returns null for null / undefined / unparseable', () => {
    expect(expiresAtMs(null)).toBeNull()
    expect(expiresAtMs(undefined)).toBeNull()
    expect(expiresAtMs('not-a-date')).toBeNull()
  })

  it('parses ISO 8601 to ms-since-epoch', () => {
    const ms = expiresAtMs('2026-12-31T23:59:59Z')
    expect(ms).toBe(Date.UTC(2026, 11, 31, 23, 59, 59))
  })

  it('parses a known RFC 3339 timestamp', () => {
    const ms = expiresAtMs('2027-01-15T08:30:00.000Z')
    expect(ms).toBe(Date.UTC(2027, 0, 15, 8, 30, 0))
  })
})
