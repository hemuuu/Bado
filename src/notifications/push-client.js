export async function ensurePushSubscription() {
  const appId = window.__ONESIGNAL_APP_ID__;
  console.groupCollapsed('[OneSignalDiag] precheck');
  console.log('origin:', window.location.origin);
  console.log('protocol:', window.location.protocol);
  console.log('hostname:', window.location.hostname);
  console.log('navigator.onLine:', navigator.onLine);
  console.log('appIdPresent:', Boolean(appId));
  console.log('notificationPermission:', typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  console.groupEnd();
  if (!appId) {
    console.warn('[OneSignalDiag] Missing window.__ONESIGNAL_APP_ID__.');
    return false;
  }
  if (!('serviceWorker' in navigator)) {
    console.warn('[OneSignalDiag] serviceWorker not supported.');
    return false;
  }
  const isLocalSecureOrigin = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (window.location.protocol !== 'https:' && !isLocalSecureOrigin) {
    console.warn('[OneSignalDiag] Invalid protocol for web push. Use HTTPS or localhost/127.0.0.1.', {
      protocol: window.location.protocol,
      origin: window.location.origin
    });
    return false;
  }

  try {
    await loadOneSignalSdkScript();
    const oneSignal = await initOneSignal(appId, isLocalSecureOrigin);
    if (!oneSignal) {
      console.warn('[OneSignalDiag] SDK initialized but OneSignal instance missing.');
      return false;
    }

    const pushSubscription = oneSignal.User?.PushSubscription;
    const isOptedIn = Boolean(pushSubscription?.optedIn);
    console.info('[OneSignalDiag] post-init state', {
      isPushSupported: oneSignal.Notifications?.isPushSupported?.() ?? null,
      currentOptedIn: isOptedIn,
      currentSubscriptionId: oneSignal.User?.PushSubscription?.id || null
    });
    if (!isOptedIn) {
      await oneSignal.Notifications.requestPermission();
      console.info('[OneSignalDiag] requestPermission completed', {
        notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
      });
    }

    const afterOptIn = Boolean(oneSignal.User?.PushSubscription?.optedIn);
    const subscriptionId = oneSignal.User?.PushSubscription?.id || null;
    console.info('[OneSignalDiag] Subscription state', {
      optedIn: afterOptIn,
      subscriptionId
    });
    return afterOptIn;
  } catch (err) {
    console.error('[OneSignalDiag] Failed to initialize/subscribe.', {
      code: err?.code || err?.name || 'unknown',
      message: err?.message || String(err),
      error: err,
      online: navigator.onLine,
      origin: window.location.origin,
      permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    });
    return false;
  }
}

let oneSignalScriptPromise = null;
let oneSignalInitPromise = null;

function loadOneSignalSdkScript() {
  if (oneSignalScriptPromise) return oneSignalScriptPromise;
  oneSignalScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-onesignal-sdk="true"]');
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    script.defer = true;
    script.dataset.onesignalSdk = 'true';
    script.onload = () => {
      console.info('[OneSignalDiag] SDK script loaded');
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load OneSignal SDK script'));
    document.head.appendChild(script);
  });
  return oneSignalScriptPromise;
}

function initOneSignal(appId, allowLocalhostAsSecureOrigin) {
  if (oneSignalInitPromise) return oneSignalInitPromise;
  oneSignalInitPromise = new Promise((resolve, reject) => {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId,
          allowLocalhostAsSecureOrigin,
          serviceWorkerPath: '/OneSignalSDKWorker.js',
          serviceWorkerUpdaterPath: '/OneSignalSDKUpdaterWorker.js'
        });
        console.info('[OneSignalDiag] OneSignal.init success', {
          appId,
          allowLocalhostAsSecureOrigin
        });

        navigator.serviceWorker.getRegistration('/').then((reg) => {
          console.info('[OneSignalDiag] Service worker registration', {
            scope: reg?.scope || null,
            activeScriptURL: reg?.active?.scriptURL || null,
            waitingScriptURL: reg?.waiting?.scriptURL || null,
            installingScriptURL: reg?.installing?.scriptURL || null
          });
        }).catch((err) => {
          console.warn('[OneSignalDiag] Failed to read service worker registration', err);
        });

        OneSignal.User?.PushSubscription?.addEventListener?.('change', (event) => {
          console.info('[OneSignalDiag] Push subscription changed', event);
        });

        OneSignal.Notifications.addEventListener('permissionChange', (granted) => {
          console.info('[OneSignalDiag] permissionChange', {
            granted,
            notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
          });
        });

        // Force visible notifications in foreground tabs and log receipt.
        OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
          try {
            console.info('[OneSignalDiag] foreground notification received', event?.notification);
            event.preventDefault();
            event.notification.display();
          } catch (err) {
            console.warn('[OneSignalDiag] foreground display hook failed', err);
          }
        });
        resolve(OneSignal);
      } catch (err) {
        reject(err);
      }
    });
  });
  return oneSignalInitPromise;
}
