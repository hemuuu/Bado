let firebaseDepsPromise = null;
let firestoreCtx = null;

async function loadFirebaseDeps() {
  if (!firebaseDepsPromise) {
    firebaseDepsPromise = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
    ]);
  }
  return firebaseDepsPromise;
}

async function ensureFirestore(firebaseConfig) {
  if (firestoreCtx) return firestoreCtx;
  const [appMod, fsMod] = await loadFirebaseDeps();
  const { initializeApp, getApps } = appMod;
  const { initializeFirestore, getFirestore, doc } = fsMod;
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

  let db;
  try {
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false
    });
    console.info('[FirebaseDiag] Firestore initialized with long-polling auto-detect.');
  } catch (err) {
    db = getFirestore(app);
    console.info('[FirebaseDiag] Firestore reused existing instance.', {
      reason: err?.code || err?.message || 'already-initialized'
    });
  }

  const stateDocRef = doc(db, 'waterMode', 'state');
  firestoreCtx = { fsMod, stateDocRef };
  return firestoreCtx;
}

export async function loadStateFromFirebase(firebaseConfig) {
  const { fsMod, stateDocRef } = await ensureFirestore(firebaseConfig);
  const { getDoc } = fsMod;
  const snap = await getDoc(stateDocRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    modelOpacityFactor: data.modelOpacityFactor,
    gestureWaterExitStreak: data.gestureWaterExitStreak,
    waterModeActive: Boolean(data.waterModeActive),
    waterModeEndsAt: Number(data.waterModeEndsAt || 0),
    activeSlotKey: data.activeSlotKey || null,
    processedSlotKeys: Array.isArray(data.processedSlotKeys) ? data.processedSlotKeys : [],
    lastWaterModeAt: Number(data.lastWaterModeAt || 0),
    lastWaterModeSlotKey: data.lastWaterModeSlotKey || null
  };
}

export async function saveStateToFirebase(firebaseConfig, state) {
  const { fsMod, stateDocRef } = await ensureFirestore(firebaseConfig);
  const { setDoc, serverTimestamp } = fsMod;
  await setDoc(stateDocRef, {
    modelOpacityFactor: state.modelOpacityFactor,
    gestureWaterExitStreak: state.gestureWaterExitStreak,
    waterModeActive: Boolean(state.waterModeActive),
    waterModeEndsAt: Math.trunc(Number(state.waterModeEndsAt || 0)),
    activeSlotKey: state.activeSlotKey || null,
    processedSlotKeys: Array.isArray(state.processedSlotKeys) ? state.processedSlotKeys : [],
    lastWaterModeAt: Math.trunc(Number(state.lastWaterModeAt || 0)),
    lastWaterModeSlotKey: state.lastWaterModeSlotKey || null,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function parseStateFromFirestoreDoc(docJson) {
  const fields = docJson?.fields || {};
  const opacityRaw = fields.modelOpacityFactor?.doubleValue
    ?? fields.modelOpacityFactor?.integerValue
    ?? null;
  const streakRaw = fields.gestureWaterExitStreak?.integerValue
    ?? fields.gestureWaterExitStreak?.doubleValue
    ?? null;
  const endsAtRaw = fields.waterModeEndsAt?.integerValue
    ?? fields.waterModeEndsAt?.doubleValue
    ?? null;
  const activeSlotKey = fields.activeSlotKey?.stringValue ?? null;
  const waterModeActive = Boolean(fields.waterModeActive?.booleanValue);
  const lastWaterModeAtRaw = fields.lastWaterModeAt?.integerValue
    ?? fields.lastWaterModeAt?.doubleValue
    ?? null;
  const lastWaterModeSlotKey = fields.lastWaterModeSlotKey?.stringValue ?? null;
  const processedSlotKeys = Array.isArray(fields.processedSlotKeys?.arrayValue?.values)
    ? fields.processedSlotKeys.arrayValue.values
        .map((entry) => entry?.stringValue)
        .filter((value) => typeof value === 'string' && value.length > 0)
    : [];
  const modelOpacityFactor = opacityRaw != null ? Number(opacityRaw) : undefined;
  const gestureWaterExitStreak = streakRaw != null ? Number.parseInt(String(streakRaw), 10) : undefined;
  const waterModeEndsAt = endsAtRaw != null ? Number(endsAtRaw) : 0;
  const lastWaterModeAt = lastWaterModeAtRaw != null ? Number(lastWaterModeAtRaw) : 0;
  return {
    modelOpacityFactor,
    gestureWaterExitStreak,
    waterModeActive,
    waterModeEndsAt,
    activeSlotKey,
    processedSlotKeys,
    lastWaterModeAt,
    lastWaterModeSlotKey
  };
}

export async function loadStateFromFirebaseRest(firebaseConfig) {
  const projectId = firebaseConfig?.projectId;
  const apiKey = firebaseConfig?.apiKey;
  if (!projectId || !apiKey) throw new Error('Missing projectId/apiKey for Firestore REST read');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/waterMode/state?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore REST read failed (${res.status}): ${txt}`);
  }
  const json = await res.json();
  return parseStateFromFirestoreDoc(json);
}

export async function saveStateToFirebaseRest(firebaseConfig, state) {
  const projectId = firebaseConfig?.projectId;
  const apiKey = firebaseConfig?.apiKey;
  if (!projectId || !apiKey) throw new Error('Missing projectId/apiKey for Firestore REST write');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/waterMode/state?key=${encodeURIComponent(apiKey)}&updateMask.fieldPaths=modelOpacityFactor&updateMask.fieldPaths=gestureWaterExitStreak&updateMask.fieldPaths=waterModeActive&updateMask.fieldPaths=waterModeEndsAt&updateMask.fieldPaths=activeSlotKey&updateMask.fieldPaths=processedSlotKeys&updateMask.fieldPaths=lastWaterModeAt&updateMask.fieldPaths=lastWaterModeSlotKey`;
  const body = {
    fields: {
      modelOpacityFactor: { doubleValue: Number(state.modelOpacityFactor) },
      gestureWaterExitStreak: { integerValue: String(Math.trunc(Number(state.gestureWaterExitStreak))) },
      waterModeActive: { booleanValue: Boolean(state.waterModeActive) },
      waterModeEndsAt: { integerValue: String(Math.trunc(Number(state.waterModeEndsAt || 0))) },
      activeSlotKey: { stringValue: state.activeSlotKey || '' },
      lastWaterModeAt: { integerValue: String(Math.trunc(Number(state.lastWaterModeAt || 0))) },
      lastWaterModeSlotKey: { stringValue: state.lastWaterModeSlotKey || '' },
      processedSlotKeys: {
        arrayValue: {
          values: (Array.isArray(state.processedSlotKeys) ? state.processedSlotKeys : [])
            .map((slotKey) => ({ stringValue: String(slotKey) }))
        }
      }
    }
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore REST write failed (${res.status}): ${txt}`);
  }
}
