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
    gestureWaterExitStreak: data.gestureWaterExitStreak
  };
}

export async function saveStateToFirebase(firebaseConfig, state) {
  const { fsMod, stateDocRef } = await ensureFirestore(firebaseConfig);
  const { setDoc, serverTimestamp } = fsMod;
  await setDoc(stateDocRef, {
    modelOpacityFactor: state.modelOpacityFactor,
    gestureWaterExitStreak: state.gestureWaterExitStreak,
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
  const modelOpacityFactor = opacityRaw != null ? Number(opacityRaw) : undefined;
  const gestureWaterExitStreak = streakRaw != null ? Number.parseInt(String(streakRaw), 10) : undefined;
  return { modelOpacityFactor, gestureWaterExitStreak };
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
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/waterMode/state?key=${encodeURIComponent(apiKey)}&updateMask.fieldPaths=modelOpacityFactor&updateMask.fieldPaths=gestureWaterExitStreak`;
  const body = {
    fields: {
      modelOpacityFactor: { doubleValue: Number(state.modelOpacityFactor) },
      gestureWaterExitStreak: { integerValue: String(Math.trunc(Number(state.gestureWaterExitStreak))) }
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
