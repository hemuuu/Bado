# Firebase Connection Guide

## 1) Create Firebase project
- Go to Firebase Console.
- Create project.
- Enable `Firestore Database`.
- Enable `Cloud Messaging`.

## 2) Add Web App config
- In Firebase Console -> Project settings -> General -> Your apps -> Web app.
- Copy config object.
- In [index.html](c:/Users/hemuu/OneDrive/Documents/rewird/index.html), set:

```html
<script>
  window.__FIREBASE_CONFIG__ = {
    apiKey: '...',
    authDomain: '...',
    projectId: '...',
    storageBucket: '...',
    messagingSenderId: '...',
    appId: '...'
  };
  window.__FIREBASE_VAPID_KEY__ = 'YOUR_WEB_PUSH_CERTIFICATE_KEY_PAIR_PUBLIC_KEY';
</script>
```

## 3) Set same config in service worker
- Open [firebase-messaging-sw.js](c:/Users/hemuu/OneDrive/Documents/rewird/firebase-messaging-sw.js).
- Replace all `REPLACE_ME` values with the same Firebase config values.

## 4) Get VAPID key
- Firebase Console -> Project settings -> Cloud Messaging -> Web configuration.
- Copy `Web Push certificates` public key.
- Put it in `window.__FIREBASE_VAPID_KEY__`.

## 5) Firestore rules (basic testing)
Use stricter rules in production. For quick test:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /waterMode/{document=**} {
      allow read, write: if true;
    }
    match /fcmTokens/{tokenId} {
      allow read, write: if true;
    }
  }
}
```

## 6) Deploy Cloud Functions for scheduled reminders
Files are here:
- [package.json](c:/Users/hemuu/OneDrive/Documents/rewird/firebase/functions/package.json)
- [index.js](c:/Users/hemuu/OneDrive/Documents/rewird/firebase/functions/src/index.js)

Commands (run in `firebase/functions`):

```bash
npm install
firebase login
firebase use <your_project_id>
firebase deploy --only functions
```

Functions deployed:
- `waterReminder0800`
- `waterReminder1200`
- `waterReminder1500`
- `waterReminder1700`
- `waterReminder2000`
- `pushTestNow` (manual trigger endpoint)

## 7) Verify flow
1. Open app, allow notification permission.
2. Confirm token saved in Firestore collection `fcmTokens`.
3. Trigger `pushTestNow` to verify immediate notification.
4. Wait for scheduled slots to verify automatic reminders even when app tab is closed.

## Notes
- Browser may still require browser process running in background for web push delivery.
- On Android Chrome this is usually reliable; on desktop depends on OS/browser background settings.
