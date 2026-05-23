export type Tier = 'free' | 'monthly' | 'yearly' | 'lifetime'

export interface ValidationRecord {
  license_key: string
  instance_id: string
  tier: Tier
  valid: 0 | 1
  expires_at: number | null
  validated_at: number
  variant_id: string | null
}

export interface ValidationResponse {
  valid: boolean
  tier: Tier
  expiresAt: number | null
  instanceId: string
  cachedAt: number
}

export interface SyncRequest {
  licenseKey: string
  instanceId: string
  sinceMs: number
  piles: Array<{ id: number; data: unknown; updatedAt: number }>
  deletions: number[]
}

export interface SyncResponse {
  serverNow: number
  piles: Array<{ id: number; data: unknown; updatedAt: number }>
  tombstones: number[]
}

export interface Env {
  DB: D1Database
  LS_API_KEY: string
  LS_VARIANT_MONTHLY: string
  LS_VARIANT_YEARLY: string
  LS_VARIANT_LIFETIME: string
  CACHE_TTL_MS: string
  ALLOWED_ORIGINS: string
}
