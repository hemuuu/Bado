// Tracking mode module: expose tracking-related initialization from the core scene.
// Tracking starts directly on launch, but this helper remains for manual restarts.

import { startAuthorizedTracking } from './scene-core.js';

// Optional: explicit API if you want to trigger tracking manually later.
export function startTrackingMode() {
  return startAuthorizedTracking();
}

// Automatically start tracking mode on module load
startTrackingMode();
