import {
  loadStateFromFirebase,
  saveStateToFirebase,
  loadStateFromFirebaseRest,
  saveStateToFirebaseRest
} from './firebase-state.js';

const LOCAL_STATE_KEY = 'water_mode_state_v1';
let firebaseDiagLogged = false;

function readLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalState(state) {
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write failures.
  }
}

function getFirebaseConfig() {
  if (typeof window === 'undefined') return null;
  return window.__FIREBASE_CONFIG__ || null;
}

function logFirebaseDiag(context, err = null, extra = {}) {
  const cfg = getFirebaseConfig();
  const code = err?.code || err?.name || 'unknown';
  const message = err?.message || String(err || '');
  console.groupCollapsed(`[FirebaseDiag] ${context}`);
  console.log('origin:', window.location.origin);
  console.log('protocol:', window.location.protocol);
  console.log('navigator.onLine:', navigator.onLine);
  console.log('projectId:', cfg?.projectId || null);
  console.log('configPresent:', Boolean(cfg));
  console.log('extra:', extra);
  if (err) {
    console.log('errorCode:', code);
    console.log('errorMessage:', message);
    console.log('errorObject:', err);
  }
  console.groupEnd();
}

export async function loadWaterState() {
  const firebaseConfig = getFirebaseConfig();
  if (!firebaseDiagLogged) {
    firebaseDiagLogged = true;
    logFirebaseDiag('startup-check');
  }
  if (firebaseConfig) {
    try {
      const state = await loadStateFromFirebase(firebaseConfig);
      if (state) {
        logFirebaseDiag('firestore-load-success', null, { source: 'firestore' });
        writeLocalState(state);
        return state;
      }
      logFirebaseDiag('firestore-load-empty-doc', null, { source: 'firestore' });
    } catch (err) {
      logFirebaseDiag('firestore-load-failed', err, { fallback: 'localStorage' });
      if (err?.code === 'unavailable') {
        try {
          const restState = await loadStateFromFirebaseRest(firebaseConfig);
          if (restState) {
            writeLocalState(restState);
            logFirebaseDiag('firestore-rest-load-success', null, { source: 'firestore-rest' });
            return restState;
          }
          logFirebaseDiag('firestore-rest-load-empty-doc', null, { source: 'firestore-rest' });
        } catch (restErr) {
          logFirebaseDiag('firestore-rest-load-failed', restErr, { fallback: 'localStorage' });
        }
      }
    }
  } else {
    logFirebaseDiag('firebase-config-missing', null, { fallback: 'localStorage' });
  }
  console.info('[FirebaseDiag] Using localStorage state fallback.');
  return readLocalState();
}

export async function saveWaterState(state) {
  writeLocalState(state);
  const firebaseConfig = getFirebaseConfig();
  if (!firebaseConfig) {
    logFirebaseDiag('save-skip-config-missing', null, { stored: 'localStorage-only' });
    return;
  }
  try {
    await saveStateToFirebase(firebaseConfig, state);
    logFirebaseDiag('firestore-save-success', null, { stored: 'firestore+localStorage' });
  } catch (err) {
    logFirebaseDiag('firestore-save-failed', err, { stored: 'localStorage-only' });
    if (err?.code === 'unavailable') {
      try {
        await saveStateToFirebaseRest(firebaseConfig, state);
        logFirebaseDiag('firestore-rest-save-success', null, { stored: 'firestore-rest+localStorage' });
      } catch (restErr) {
        logFirebaseDiag('firestore-rest-save-failed', restErr, { stored: 'localStorage-only' });
      }
    }
  }
}
