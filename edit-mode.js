// Edit mode module: expose overlay/edit-mode controls from the core scene.

import { toggleOverlay } from './scene-core.js';

// Optional helper to enter edit mode explicitly.
export function enterEditMode() {
  // toggle on if currently off
  toggleOverlay();
}

// Optional helper to exit edit mode explicitly.
export function exitEditMode() {
  // toggle off if currently on
  toggleOverlay();
}

// Re-export the raw toggle in case the app wants direct control.
export { toggleOverlay };

