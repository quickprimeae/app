// src/lib/pin.ts
// PIN hashing, token generation, and validation utilities.

import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const SALT_ROUNDS = 12

// ── Hash a PIN before storing ──────────────────────────────
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS)
}

// ── Verify a PIN attempt against stored hash ──────────────
export async function verifyPin(
  pin: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(pin, hash)
}

// ── Generate a one-time setup token ───────────────────────
// Returns both the raw token (for the URL) and a hash (for storage)
export function generateSetupToken(): {
  token: string
  hash: string
  expires: Date
} {
  const token = crypto.randomBytes(32).toString('hex')
  const hash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex')
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
  return { token, hash, expires }
}

// ── Hash a token for lookup ────────────────────────────────
export function hashToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex')
}

// ── Build the PIN setup URL ────────────────────────────────
export function buildSetupUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/setup-pin?token=${token}`
}
