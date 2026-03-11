// Tracking mode module: expose tracking-related initialization from the core scene.
// Tracking now starts only after face authorization succeeds.

import { startAuthorizedTracking } from './scene-core.js';

// Optional: explicit API if you want to trigger tracking manually later.
export function startTrackingMode() {
  return startAuthorizedTracking();
}
