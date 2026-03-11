const DEG_TO_RAD = Math.PI / 180;

export const PRE_ENROLLMENT_YAW = -42 * DEG_TO_RAD;
export const PRE_ENROLLMENT_BLEND_TIME = 0.45;
export const PRE_ENROLLMENT_UNLOCK_THRESHOLD = 0.98;

export function nextUnlockBlend(current, ownerVerified, deltaSeconds) {
  const safeDelta = Math.max(1e-6, deltaSeconds);
  const lerp = 1 - Math.exp(-safeDelta / PRE_ENROLLMENT_BLEND_TIME);
  const target = ownerVerified ? 1 : 0;
  const next = current + (target - current) * lerp;
  return Math.min(1, Math.max(0, next));
}

export function areControlsUnlocked(ownerVerified, unlockBlend) {
  return ownerVerified && unlockBlend >= PRE_ENROLLMENT_UNLOCK_THRESHOLD;
}
