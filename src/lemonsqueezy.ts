// Thin wrapper around the Lemon Squeezy License API.
// Docs: https://docs.lemonsqueezy.com/api/license-api

import type { Env, Tier } from './types'

const LS_BASE = 'https://api.lemonsqueezy.com/v1'

interface LSLicenseResponse {
  valid: boolean
  error?: string
  license_key?: {
    id: number
    status: 'active' | 'expired' | 'disabled' | 'inactive'
    key: string
    activation_limit: number | null
    activation_usage: number
    expires_at: string | null
  }
  instance?: { id: string; name: string; created_at: string }
  meta?: { variant_id: string; variant_name: string; product_id: string }
}

async function lsCall(
  env: Env,
  path: '/licenses/validate' | '/licenses/activate' | '/licenses/deactivate',
  body: Record<string, string>,
): Promise<LSLicenseResponse> {
  const params = new URLSearchParams(body)
  const res = await fetch(`${LS_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LS_API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  if (!res.ok) {
    // LS returns JSON error bodies. Surface them to caller.
    const text = await res.text()
    throw new Error(`LS ${path} HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as LSLicenseResponse
}

export async function activate(
  env: Env,
  licenseKey: string,
  instanceName: string,
): Promise<LSLicenseResponse> {
  return lsCall(env, '/licenses/activate', { license_key: licenseKey, instance_name: instanceName })
}

export async function validate(
  env: Env,
  licenseKey: string,
  instanceId: string,
): Promise<LSLicenseResponse> {
  return lsCall(env, '/licenses/validate', { license_key: licenseKey, instance_id: instanceId })
}

export async function deactivate(
  env: Env,
  licenseKey: string,
  instanceId: string,
): Promise<LSLicenseResponse> {
  return lsCall(env, '/licenses/deactivate', { license_key: licenseKey, instance_id: instanceId })
}

export function variantToTier(variantId: string | undefined, env: Env): Tier {
  if (!variantId) return 'free'
  if (variantId === env.LS_VARIANT_MONTHLY) return 'monthly'
  if (variantId === env.LS_VARIANT_YEARLY) return 'yearly'
  if (variantId === env.LS_VARIANT_LIFETIME) return 'lifetime'
  return 'free'
}

export function expiresAtMs(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null
  const ms = Date.parse(expiresAt)
  return Number.isFinite(ms) ? ms : null
}
