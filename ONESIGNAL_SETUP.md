# OneSignal Setup

1. Create a OneSignal app (Web Push platform).
2. Add your site origin:
- Local test: `http://127.0.0.1:5503` (or your local host/port)
- Production: your HTTPS domain
3. Copy your OneSignal **App ID**.
4. Set it in [index.html](c:/Users/hemuu/OneDrive/Documents/rewird/index.html):

```html
window.__ONESIGNAL_APP_ID__ = 'YOUR_ONESIGNAL_APP_ID';
```

5. Keep these files at project root (already added):
- [OneSignalSDKWorker.js](c:/Users/hemuu/OneDrive/Documents/rewird/OneSignalSDKWorker.js)
- [OneSignalSDKUpdaterWorker.js](c:/Users/hemuu/OneDrive/Documents/rewird/OneSignalSDKUpdaterWorker.js)

6. Open the app and accept notification permission.
7. Verify in browser console:
- `[OneSignalDiag] Subscription state`

8. In OneSignal dashboard:
- Confirm subscriber appears.
- Create/schedule push for `08:00, 12:00, 15:00, 17:00, 20:00` (Asia/Kolkata).
