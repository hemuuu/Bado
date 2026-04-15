const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const WATER_MESSAGE = "hey i am drinking water, i'll be there for 15 minutes .";
const WATER_MODE_DURATION_MS = 15 * 60 * 1000;
const OPACITY_PENALTY_FACTOR = 0.99;
const MIN_OPACITY_FACTOR = 0.2;
const MAX_OPACITY_FACTOR = 1.0;
const WATER_STATE_DOC = db.collection('waterMode').doc('state');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildSlotKey(hour, minute, now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${year}-${month}-${day}_${hh}:${mm}`;
}

async function activateWaterModeSlot(hour, minute) {
  const slotKey = buildSlotKey(hour, minute);
  const endsAt = Date.now() + WATER_MODE_DURATION_MS;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(WATER_STATE_DOC);
    const data = snap.exists ? snap.data() : {};
    const processedSlotKeys = Array.isArray(data.processedSlotKeys) ? data.processedSlotKeys : [];
    if (processedSlotKeys.includes(slotKey)) return;

    tx.set(WATER_STATE_DOC, {
      waterModeActive: true,
      waterModeEndsAt: endsAt,
      activeSlotKey: slotKey,
      lastWaterModeAt: Date.now(),
      lastWaterModeSlotKey: slotKey,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return { slotKey, endsAt };
}

async function completeWaterModeSlot(hour, minute) {
  const slotKey = buildSlotKey(hour, minute);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(WATER_STATE_DOC);
    const data = snap.exists ? snap.data() : {};
    const processedSlotKeys = Array.isArray(data.processedSlotKeys) ? data.processedSlotKeys : [];
    if (processedSlotKeys.includes(slotKey)) return;

    const nextState = {
      waterModeActive: false,
      waterModeEndsAt: 0,
      activeSlotKey: null,
      processedSlotKeys: FieldValue.arrayUnion(slotKey),
      updatedAt: FieldValue.serverTimestamp()
    };

    if (data.activeSlotKey === slotKey && data.waterModeActive) {
      const currentOpacity = Number(data.modelOpacityFactor ?? 1);
      nextState.modelOpacityFactor = clamp(currentOpacity * OPACITY_PENALTY_FACTOR, MIN_OPACITY_FACTOR, MAX_OPACITY_FACTOR);
      nextState.gestureWaterExitStreak = 0;
      nextState.lastWaterModeAt = Date.now();
      nextState.lastWaterModeSlotKey = slotKey;
    }

    tx.set(WATER_STATE_DOC, nextState, { merge: true });
  });

  return { slotKey };
}

async function sendToAllTokens() {
  const snap = await db.collection('fcmTokens').get();
  const tokens = snap.docs.map((d) => d.id).filter(Boolean);
  if (!tokens.length) return { sent: 0, total: 0 };

  const messaging = admin.messaging();
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: 'Water Mode',
      body: WATER_MESSAGE
    },
    data: {
      type: 'water_mode_start'
    },
    webpush: {
      headers: {
        Urgency: 'high'
      },
      notification: {
        title: 'Water Mode',
        body: WATER_MESSAGE,
        requireInteraction: true
      }
    }
  });

  const batch = db.batch();
  response.responses.forEach((r, idx) => {
    if (!r.success && r.error) {
      const code = r.error.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
        const ref = db.collection('fcmTokens').doc(tokens[idx]);
        batch.delete(ref);
      }
    }
  });
  await batch.commit();
  return { sent: response.successCount, total: tokens.length };
}

exports.waterReminder0800 = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'Asia/Kolkata' },
  async () => {
    await activateWaterModeSlot(8, 0);
    return sendToAllTokens();
  }
);

exports.waterReminder1200 = onSchedule(
  { schedule: '0 12 * * *', timeZone: 'Asia/Kolkata' },
  async () => {
    await activateWaterModeSlot(12, 0);
    return sendToAllTokens();
  }
);

exports.waterReminder1500 = onSchedule(
  { schedule: '0 15 * * *', timeZone: 'Asia/Kolkata' },
  async () => {
    await activateWaterModeSlot(15, 0);
    return sendToAllTokens();
  }
);

exports.waterReminder1700 = onSchedule(
  { schedule: '0 17 * * *', timeZone: 'Asia/Kolkata' },
  async () => {
    await activateWaterModeSlot(17, 0);
    return sendToAllTokens();
  }
);

exports.waterReminder2000 = onSchedule(
  { schedule: '0 20 * * *', timeZone: 'Asia/Kolkata' },
  async () => {
    await activateWaterModeSlot(20, 0);
    return sendToAllTokens();
  }
);

exports.waterReminder0815Timeout = onSchedule(
  { schedule: '15 8 * * *', timeZone: 'Asia/Kolkata' },
  async () => completeWaterModeSlot(8, 0)
);

exports.waterReminder1215Timeout = onSchedule(
  { schedule: '15 12 * * *', timeZone: 'Asia/Kolkata' },
  async () => completeWaterModeSlot(12, 0)
);

exports.waterReminder1515Timeout = onSchedule(
  { schedule: '15 15 * * *', timeZone: 'Asia/Kolkata' },
  async () => completeWaterModeSlot(15, 0)
);

exports.waterReminder1715Timeout = onSchedule(
  { schedule: '15 17 * * *', timeZone: 'Asia/Kolkata' },
  async () => completeWaterModeSlot(17, 0)
);

exports.waterReminder2015Timeout = onSchedule(
  { schedule: '15 20 * * *', timeZone: 'Asia/Kolkata' },
  async () => completeWaterModeSlot(20, 0)
);

exports.pushTestNow = onRequest(async (_req, res) => {
  try {
    const result = await sendToAllTokens();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
