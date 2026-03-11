const fs = require('fs');
const path = require('path');
const express = require('express');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'app-state.json');
const PUSH_SUBS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');
const PUSH_SENT_FILE = path.join(DATA_DIR, 'push-sent-log.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid-keys.json');

const WATER_SLOTS = ['08:00', '12:00', '15:00', '17:00', '20:00'];
const PUSH_MESSAGE = "hey i am drinking water, i'll be there for 15 minutes .";

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.static(__dirname));

ensureDataFiles();
const vapidKeys = loadOrCreateVapidKeys();
webpush.setVapidDetails(
  'mailto:water-mode@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get('/api/state', (_req, res) => {
  const state = readJson(STATE_FILE, defaultState());
  res.json(state);
});

app.put('/api/state', (req, res) => {
  const current = readJson(STATE_FILE, defaultState());
  const next = {
    modelOpacityFactor: clampNumber(
      req.body?.modelOpacityFactor,
      0.2,
      1.0,
      current.modelOpacityFactor
    ),
    gestureWaterExitStreak: clampInt(
      req.body?.gestureWaterExitStreak,
      0,
      3,
      current.gestureWaterExitStreak
    ),
    updatedAt: new Date().toISOString()
  };
  writeJson(STATE_FILE, next);
  res.json(next);
});

app.get('/api/push/public-key', (_req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    res.status(400).json({ error: 'Invalid push subscription payload' });
    return;
  }

  const subs = readJson(PUSH_SUBS_FILE, []);
  const exists = subs.some((s) => s.endpoint === sub.endpoint);
  if (!exists) {
    subs.push(sub);
    writeJson(PUSH_SUBS_FILE, subs);
  }
  res.json({ ok: true, total: subs.length });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) {
    res.status(400).json({ error: 'Missing endpoint' });
    return;
  }
  const subs = readJson(PUSH_SUBS_FILE, []);
  const next = subs.filter((s) => s.endpoint !== endpoint);
  writeJson(PUSH_SUBS_FILE, next);
  res.json({ ok: true, total: next.length });
});

app.post('/api/push/test', async (_req, res) => {
  const count = await sendPushToAll(PUSH_MESSAGE);
  res.json({ ok: true, sent: count });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

startWaterPushScheduler();

function startWaterPushScheduler() {
  runSlotCheck();
  setInterval(runSlotCheck, 20000);
}

async function runSlotCheck() {
  const now = new Date();
  const hour = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const hhmm = `${hour}:${min}`;
  if (!WATER_SLOTS.includes(hhmm)) return;

  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const slotKey = `${dateKey}_${hhmm}`;
  const sentLog = readJson(PUSH_SENT_FILE, {});
  if (sentLog[slotKey]) return;

  const sent = await sendPushToAll(PUSH_MESSAGE);
  sentLog[slotKey] = {
    sent,
    at: new Date().toISOString()
  };
  writeJson(PUSH_SENT_FILE, sentLog);
}

async function sendPushToAll(message) {
  const subs = readJson(PUSH_SUBS_FILE, []);
  if (!subs.length) return 0;
  const payload = JSON.stringify({
    title: 'Water Mode',
    body: message,
    url: '/',
    tag: 'water-mode-reminder'
  });

  const keep = [];
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      keep.push(sub);
      sent += 1;
    } catch (err) {
      const statusCode = err?.statusCode;
      if (statusCode !== 404 && statusCode !== 410) {
        keep.push(sub);
      }
    }
  }
  if (keep.length !== subs.length) writeJson(PUSH_SUBS_FILE, keep);
  return sent;
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) writeJson(STATE_FILE, defaultState());
  if (!fs.existsSync(PUSH_SUBS_FILE)) writeJson(PUSH_SUBS_FILE, []);
  if (!fs.existsSync(PUSH_SENT_FILE)) writeJson(PUSH_SENT_FILE, {});
}

function loadOrCreateVapidKeys() {
  const existing = readJson(VAPID_FILE, null);
  if (existing?.publicKey && existing?.privateKey) return existing;
  const generated = webpush.generateVAPIDKeys();
  writeJson(VAPID_FILE, generated);
  return generated;
}

function defaultState() {
  return {
    modelOpacityFactor: 1.0,
    gestureWaterExitStreak: 0,
    updatedAt: new Date().toISOString()
  };
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
