/* global importScripts, firebase */
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDFbPwFQ-gHoYgwIqInOXrPvw_4Q4EtXug',
  authDomain: 'codenamebado.firebaseapp.com',
  projectId: 'codenamebado',
  storageBucket: 'codenamebado.firebasestorage.app',
  messagingSenderId: '950581107294',
  appId: '1:950581107294:web:7099ed382ffbe05072f2cf'
};

firebase.initializeApp(FIREBASE_CONFIG);

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'Water Mode';
  const body = payload?.notification?.body || "hey i am drinking water, i'll be there for 15 minutes .";
  const notificationOptions = {
    body,
    icon: '/favicon.ico',
    data: payload?.data || {}
  };
  self.registration.showNotification(title, notificationOptions);
});
