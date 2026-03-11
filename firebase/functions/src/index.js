const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');

admin.initializeApp();
const db = admin.firestore();

const WATER_MESSAGE = "hey i am drinking water, i'll be there for 15 minutes .";

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
  async () => sendToAllTokens()
);

exports.waterReminder1200 = onSchedule(
  { schedule: '0 12 * * *', timeZone: 'Asia/Kolkata' },
  async () => sendToAllTokens()
);

exports.waterReminder1500 = onSchedule(
  { schedule: '0 15 * * *', timeZone: 'Asia/Kolkata' },
  async () => sendToAllTokens()
);

exports.waterReminder1700 = onSchedule(
  { schedule: '0 17 * * *', timeZone: 'Asia/Kolkata' },
  async () => sendToAllTokens()
);

exports.waterReminder2000 = onSchedule(
  { schedule: '0 20 * * *', timeZone: 'Asia/Kolkata' },
  async () => sendToAllTokens()
);

exports.pushTestNow = onRequest(async (_req, res) => {
  try {
    const result = await sendToAllTokens();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
