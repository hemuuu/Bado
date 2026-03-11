// Water mode module: expose water-mode controls through water-core.

import {
  startManualWaterMode,
  startAutoWaterMode,
  stopWaterModeWithPenalty,
  stopWaterModeNoPenalty,
  startWaterMode,
  stopWaterMode,
} from './water-core.js';

// Re-export for direct use, so other code can choose between
// high-level helpers or the low-level functions.
export {
  startManualWaterMode,
  startAutoWaterMode,
  stopWaterModeWithPenalty,
  stopWaterModeNoPenalty,
  startWaterMode,
  stopWaterMode,
};


