// src/lib/face-config.ts
// SERVER-side face-match thresholds. Read from env so they can be tuned WITHOUT
// a code redeploy (change the env var on the host + restart). face-api euclidean
// distance: lower = more similar; ~0.6 is the library's standard match cutoff.
//
//   distance <= PASS        -> 'pass'  (proceed)
//   PASS < distance <= BLOCK -> 'flag' (accept but needs_review)
//   distance >  BLOCK       -> 'block' (refuse, retry)
//
// faceVerdict() is the single source of truth for the gateable result, so the
// punch flow (Sub-step 3) can call it to gate a clock_event before commit.

export const FACE_MATCH_PASS = Number(process.env.FACE_MATCH_PASS ?? 0.5)
export const FACE_MATCH_BLOCK = Number(process.env.FACE_MATCH_BLOCK ?? 0.6)
export const FACE_DESCRIPTOR_LENGTH = 128

export type FaceVerdict = 'pass' | 'flag' | 'block'

export function faceVerdict(distance: number): FaceVerdict {
  if (distance <= FACE_MATCH_PASS) return 'pass'
  if (distance <= FACE_MATCH_BLOCK) return 'flag'
  return 'block'
}

export function faceThresholds() {
  return { pass: FACE_MATCH_PASS, block: FACE_MATCH_BLOCK }
}

// Euclidean distance between two equal-length descriptors.
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}
