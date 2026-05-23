import type { Env, Tier, ValidationRecord } from './types'

export async function getCached(
  env: Env,
  licenseKey: string,
  instanceId: string,
): Promise<ValidationRecord | null> {
  const row = await env.DB.prepare(
    'SELECT license_key, instance_id, tier, valid, expires_at, validated_at, variant_id ' +
      'FROM validations WHERE license_key = ?1 AND instance_id = ?2',
  )
    .bind(licenseKey, instanceId)
    .first<ValidationRecord>()
  return row ?? null
}

export async function upsertCache(
  env: Env,
  licenseKey: string,
  instanceId: string,
  tier: Tier,
  valid: boolean,
  expiresAt: number | null,
  variantId: string | null,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO validations (license_key, instance_id, tier, valid, expires_at, validated_at, variant_id) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ' +
      'ON CONFLICT(license_key, instance_id) DO UPDATE SET ' +
      '  tier = excluded.tier, ' +
      '  valid = excluded.valid, ' +
      '  expires_at = excluded.expires_at, ' +
      '  validated_at = excluded.validated_at, ' +
      '  variant_id = excluded.variant_id',
  )
    .bind(licenseKey, instanceId, tier, valid ? 1 : 0, expiresAt, now, variantId)
    .run()
}

export async function clearCache(env: Env, licenseKey: string, instanceId: string): Promise<void> {
  await env.DB.prepare(
    'DELETE FROM validations WHERE license_key = ?1 AND instance_id = ?2',
  )
    .bind(licenseKey, instanceId)
    .run()
}

export function isCacheFresh(record: ValidationRecord, ttlMs: number, now: number): boolean {
  return now - record.validated_at < ttlMs
}
