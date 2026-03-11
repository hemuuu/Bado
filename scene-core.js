import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FilesetResolver, GestureRecognizer, FaceLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { createSceneRuntime } from './src/scene/create-scene-runtime.js';
import { initWebcam } from './src/input/webcam.js';
import {
  detectPinchGesture,
  getSmoothedFingerPos,
  getSmoothedPinchDistance
} from './src/utils/pinch.js';
import { ensurePushSubscription } from './src/notifications/push-client.js';
import { loadWaterState, saveWaterState } from './src/backend/state-store.js';

/* SCENE */
const { scene, camera, renderer, floor } = createSceneRuntime();
document.body.appendChild(renderer.domElement);

/* MODEL */
let model, mixer, start, end;
let leftPupil, rightPupil;
let lipsMesh, mouthMesh, faceMesh;
let leftEar, rightEar;
let closeButtonMesh = null;
const originalMaterials = new Map();
const DEFAULT_MODEL_PATH = './mediapipe4.glb';
const WATER_MODEL_PATH = './mediapipe4_water.glb';
let currentModelPath = DEFAULT_MODEL_PATH;
let modelLoadToken = 0;
let modelBaseY = 0;

const WATER_MODE_SLOTS = [
  { hour: 12, minute: 0, label: '12:00' },
  { hour: 8, minute: 0, label: '08:00' },
  { hour: 15, minute: 0, label: '15:00' },
  { hour: 17, minute: 0, label: '17:00' },
  { hour: 20, minute: 0, label: '20:00' }
];
const WATER_MODE_DURATION_MS = 15 * 60 * 1000;
const WATER_SCHEDULE_CHECK_MS = 15000;
const WATER_STOP_HOLD_THRESHOLD = 4;
const WATER_AUDIO_PATH = './water-drinking.mp3';
const OPACITY_PENALTY_FACTOR = 0.93;
const OPACITY_REWARD_FACTOR = 1.10;
const MIN_OPACITY_FACTOR = 0.2;
const MAX_OPACITY_FACTOR = 1.0;
let waterModeActive = false;
let waterModeEndsAt = 0;
let waterModeTimeout = null;
let waterScheduleTimer = null;
let waterStopHoldFrames = 0;
const consumedWaterSlots = new Set();
let waterAudioContext = null;
let waterAudioInterval = null;
let waterLoopAudio = null;
let waterTestControls = null;
let modelOpacityFactor = 1.0;
let gestureWaterExitStreak = 0;
let notificationPermissionRequested = false;
let pushSubscriptionReady = false;

const loader = new GLTFLoader();
loadModel(DEFAULT_MODEL_PATH);
loadPersistentWaterState();

function disposeCurrentModel() {
  if (!model) return;
  if (mixer) {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    mixer = null;
  }
  scene.remove(model);
  model.traverse((c) => {
    if (!c.isMesh) return;
    if (c.geometry) c.geometry.dispose();
    if (Array.isArray(c.material)) {
      c.material.forEach((m) => m && m.dispose());
    } else if (c.material) {
      c.material.dispose();
    }
  });
  if (closeButtonMesh?.parent) closeButtonMesh.parent.remove(closeButtonMesh);
  originalMaterials.clear();
  model = null;
  leftPupil = null;
  rightPupil = null;
  lipsMesh = null;
  mouthMesh = null;
  faceMesh = null;
  leftEar = null;
  rightEar = null;
}

function loadModel(path) {
  const token = ++modelLoadToken;
  loader.load(path, (gltf) => {
    if (token !== modelLoadToken) return;
    disposeCurrentModel();
    model = gltf.scene;
    currentModelPath = path;
    scene.add(model);

    model.traverse((c) => {
      if (!c.isMesh || !c.material) return;

      originalMaterials.set(c, c.material.clone());
      c.castShadow = true;
      c.material.roughness = 0.45;
      c.material.metalness = 0.0;
      c.material.envMapIntensity = 0.9;

      const name = (c.name || '').toLowerCase();
      if (name === 'face') faceMesh = c;
      if (name.includes('lip')) lipsMesh = c;
      if (name.includes('mouth')) mouthMesh = c;
      if (name.includes('l_pupil')) leftPupil = c;
      if (name.includes('r_pupil')) rightPupil = c;
      if (name.includes('l_ear')) leftEar = c;
      if (name.includes('r_ear')) rightEar = c;

      if (name.includes('eye')) {
        c.material.roughness = 0.1;
        c.material.envMapIntensity = 1.5;
      }

      c.material.needsUpdate = true;
    });
    applyModelOpacityFactor();

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    modelBaseY = model.position.y;
    model.rotation.x = THREE.MathUtils.degToRad(15);
    model.scale.set(0.6177375, 0.6177375, 0.6177375);

    floor.position.y = -size.y / 2 - 0.55;
    const maxDim = Math.max(size.x, size.y, size.z);
    const cameraZ = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.5;
    camera.position.set(0, 0.2, cameraZ);
    camera.lookAt(0, 0, 0);

    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play();
      action.setLoop(THREE.LoopRepeat);
      const fps = 24;
      start = 4 / fps;
      end = 35 / fps;
    }

    if (!closeButtonMesh) closeButtonMesh = createCloseButton();
    closeButtonMesh.visible = overlayActive && !waterModeActive;
    if (faceMesh) {
      faceMesh.add(closeButtonMesh);
      closeButtonMesh.position.set(1.7, 0.85, 0.5);
    } else {
      scene.add(closeButtonMesh);
    }
  }, undefined, (err) => {
    console.error(`Failed to load model at ${path}:`, err);
  });
}

function applyModelOpacityFactor() {
  if (!model) return;
  model.traverse((c) => {
    if (!c.isMesh || !c.material || !originalMaterials.has(c)) return;
    const original = originalMaterials.get(c);
    const targetOpacity = THREE.MathUtils.clamp(original.opacity * modelOpacityFactor, 0, 1);
    c.material.opacity = targetOpacity;
    c.material.transparent = original.transparent || targetOpacity < 0.999;
    c.material.needsUpdate = true;
  });
}

async function loadPersistentWaterState() {
  try {
    const state = await loadWaterState();
    if (!state) return;
    const loadedOpacity = Number(state?.modelOpacityFactor);
    const loadedStreak = Number.parseInt(state?.gestureWaterExitStreak, 10);
    if (Number.isFinite(loadedOpacity)) {
      modelOpacityFactor = THREE.MathUtils.clamp(loadedOpacity, MIN_OPACITY_FACTOR, MAX_OPACITY_FACTOR);
    }
    if (Number.isFinite(loadedStreak)) {
      gestureWaterExitStreak = THREE.MathUtils.clamp(loadedStreak, 0, 3);
    }
    applyModelOpacityFactor();
  } catch (err) {
    console.warn('Persistent state unavailable, using in-memory defaults:', err);
  }
}

async function savePersistentWaterState() {
  try {
    await saveWaterState({
      modelOpacityFactor,
      gestureWaterExitStreak
    });
  } catch (err) {
    console.warn('Failed to persist water state:', err);
  }
}

function createCloseButton() {
  const buttonGroup = new THREE.Group();

  const circleGeometry = new THREE.CylinderGeometry(0.075, 0.075, 0.025, 32);
  const circleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.1
  });
  const circle = new THREE.Mesh(circleGeometry, circleMaterial);
  circle.rotation.x = Math.PI / 2;
  circle.castShadow = true;
  buttonGroup.add(circle);

  const barGeometry = new THREE.BoxGeometry(0.075, 0.015, 0.015);
  const barMaterial = new THREE.MeshStandardMaterial({
    color: 0x305cde,
    roughness: 0.4,
    metalness: 0.05
  });
  const bar1 = new THREE.Mesh(barGeometry, barMaterial);
  bar1.rotation.z = Math.PI / 4;
  bar1.position.z = 0.015;
  buttonGroup.add(bar1);
  const bar2 = new THREE.Mesh(barGeometry, barMaterial);
  bar2.rotation.z = -Math.PI / 4;
  bar2.position.z = 0.015;
  buttonGroup.add(bar2);

  const squareWidth = 1;
  const squareHeight = 0.65;
  const squareGeometry = new THREE.BufferGeometry();
  const squareVertices = new Float32Array([
    -squareWidth, -squareHeight, 0,
    squareWidth, -squareHeight, 0,
    squareWidth, -squareHeight, 0,
    squareWidth, squareHeight, 0,
    squareWidth, squareHeight, 0,
    -squareWidth, squareHeight, 0,
    -squareWidth, squareHeight, 0,
    -squareWidth, -squareHeight, 0
  ]);
  squareGeometry.setAttribute('position', new THREE.BufferAttribute(squareVertices, 3));
  const squareMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8
  });
  const squareOutline = new THREE.LineSegments(squareGeometry, squareMaterial);
  squareOutline.name = 'squareOutline';
  squareOutline.visible = false;
  squareOutline.position.set(-squareWidth, -squareHeight, 0);
  buttonGroup.add(squareOutline);
  buttonGroup.scale.setScalar(1.08);

  return buttonGroup;
}

/* WEBCAM */
const video = document.getElementById('webcam');
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');
const webcamContainer = document.getElementById('webcamContainer');
overlayCanvas.width = 220;
overlayCanvas.height = 165;
if (webcamContainer) webcamContainer.style.display = 'none';
let authorizedTrackingStarted = false;
let authorizedTrackingStartPromise = null;
let mediaPipeInitialized = false;
let trackingRetryTimer = null;
let trackingRetryCount = 0;
const TRACKING_RETRY_DELAY_MS = 3000;

/* UI / MODES */
const gestureIndicator = document.getElementById('gestureIndicator');
let overlayActive = false;
let gestureRecognizer;
let faceLandmarker;
let lastToggleTime = 0;
const TOGGLE_COOLDOWN = 1500;
let consecutivePalmDetections = 0;
let palmHoldFrames = 0;
const REQUIRED_CONSECUTIVE_DETECTIONS = 1;
const PALM_HOLD_THRESHOLD = 3;

/* TRACKING STATE */
let eyeTrackedX = 0, eyeTrackedY = 0;
let eyeCurrentX = 0, eyeCurrentY = 0;
let faceRoll = 0, facePitch = 0, faceDepth = 0;
let faceRollCurrent = 0, facePitchCurrent = 0, faceDepthCurrent = 0;
let neutralHeight = null;
let mouthOpen = 0, mouthCurrent = 0;
let rawEyeDist = null;
let baselineEyeDist = null;
let smoothedEyeDist = null;
let inceptionCaptured = false;
const EYE_DIST_SMOOTH_TIME = 0.16;
let isTracking = false, lostFrames = 0;

/* EDIT MODE CONTROL STATE */
let baselineScale = 0.6177375;
let targetScale = 0.6177375;
let currentScale = 0.6177375;
const MIN_SCALE_RATIO = 0.5;
const MAX_SCALE_RATIO = 2.0;
let initialPinchDistance = -1;
let pinchDistanceHistory = [];
const PINCH_HISTORY_SIZE = 5;
let isPinching = false;
let pinchLostFrames = 0;
const PINCH_LOST_THRESHOLD = 8;

let baselineRotationY = 0;
let targetRotationY = 0;
let currentRotationY = 0;
let initialIndexFingerY = -1;
const MAX_ROTATION = Math.PI;

const MODEL_X_OFFSET = -0.25;
let baselinePositionX = MODEL_X_OFFSET;
let targetPositionX = MODEL_X_OFFSET;
let currentPositionX = MODEL_X_OFFSET;
const MODEL_Y_OFFSET = 0;
let baselinePositionY = MODEL_Y_OFFSET;
let targetPositionY = MODEL_Y_OFFSET;
let currentPositionY = MODEL_Y_OFFSET;
let initialIndexFingerX = -1;
const MAX_POSITION_X = 3;
const MIN_POSITION_Y = -0.45;
const MAX_POSITION_Y = 0.95;
const IS_MOBILE_DEVICE = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);

let indexFingerYHistory = [];
let indexFingerXHistory = [];
const FINGER_HISTORY_SIZE = 7;

let lastVideoTime = -1;
let lastProcessTime = 0;
const PROCESS_INTERVAL = 33;
const SMOOTH_TIME_EDIT = 0.18;
const SMOOTH_TIME_NORMAL = 0.12;
const SMOOTH_TIME_FACE_TRACK = 0.18;
const SMOOTH_TIME_FACE_ROLL = 0.26;
const SMOOTH_TIME_EYE = 0.18;
const SMOOTH_TIME_MOUTH = 0.16;
const EYE_INPUT_SMOOTHING = 0.35;
const PITCH_INPUT_SMOOTHING = 0.35;
const ROLL_INPUT_SMOOTHING = 0.4;
const ROLL_DEADZONE_DEG = 0.5;

/* MEDIAPIPE */
async function initMediaPipe() {
  if (mediaPipeInitialized) return;
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );

  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.3,
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3
  });

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    refineLandmarks: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  console.log('MediaPipe initialized successfully');
  mediaPipeInitialized = true;
  startDetection();
}

async function startAuthorizedTracking() {
  if (authorizedTrackingStarted) return;
  if (authorizedTrackingStartPromise) return authorizedTrackingStartPromise;

  authorizedTrackingStartPromise = (async () => {
    try {
      await initWebcam(video);
      if (webcamContainer) webcamContainer.style.display = '';
      await initMediaPipe();
      initWaterModeScheduler();
      ensureWaterTestControls();
      authorizedTrackingStarted = true;
      trackingRetryCount = 0;
      if (trackingRetryTimer) {
        clearTimeout(trackingRetryTimer);
        trackingRetryTimer = null;
      }
      gestureIndicator.classList.remove('active');
      gestureIndicator.textContent = 'Palm Detected!';
    } catch (err) {
      // Allow new retry attempts instead of getting stuck on a rejected promise.
      authorizedTrackingStartPromise = null;
      throw err;
    }
  })();

  return authorizedTrackingStartPromise;
}

function scheduleTrackingRetry(lastError) {
  if (authorizedTrackingStarted) return;
  if (trackingRetryTimer) return;
  trackingRetryCount += 1;
  console.warn('[TrackingDiag] Tracking start failed. Retrying...', {
    retry: trackingRetryCount,
    delayMs: TRACKING_RETRY_DELAY_MS,
    error: lastError?.message || String(lastError)
  });
  gestureIndicator.classList.add('active');
  gestureIndicator.textContent = `Tracking retry ${trackingRetryCount}...`;
  trackingRetryTimer = setTimeout(() => {
    trackingRetryTimer = null;
    startAuthorizedTracking().catch((err) => scheduleTrackingRetry(err));
  }, TRACKING_RETRY_DELAY_MS);
}

function initFaceAuthGate() {
  const setWaitingState = () => {
    gestureIndicator.classList.add('active');
    gestureIndicator.textContent = 'Waiting for face authorization...';
  };

  const handleFaceAuth = (passed) => {
    if (passed) {
      startAuthorizedTracking().catch((err) => {
        console.error('Failed to start tracking after face authorization:', err);
        scheduleTrackingRetry(err);
      });
      return;
    }
    gestureIndicator.classList.add('active');
    gestureIndicator.textContent = 'Face authorization failed';
  };

  window.addEventListener('faceauth', (e) => {
    const passed = Boolean(e.detail?.passed);
    handleFaceAuth(passed);
  });

  if (window.faceAuthPassed === true) {
    handleFaceAuth(true);
  } else if (window.faceAuthPassed === false) {
    handleFaceAuth(false);
  } else {
    setWaitingState();
  }
}

/* EDIT MODE TOGGLE */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

renderer.domElement.addEventListener('click', (event) => {
  if (!overlayActive || !closeButtonMesh) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(closeButtonMesh.children, true);
  if (intersects.length > 0) toggleOverlay();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    toggleOverlay();
  }
});

function toggleOverlay() {
  if (waterModeActive) return;
  const now = Date.now();
  if (now - lastToggleTime < TOGGLE_COOLDOWN) return;
  lastToggleTime = now;
  overlayActive = !overlayActive;

  if (overlayActive) {
    baselineScale = currentScale;
    targetScale = currentScale;
    baselineRotationY = currentRotationY;
    targetRotationY = currentRotationY;
    baselinePositionX = currentPositionX;
    targetPositionX = currentPositionX;
    baselinePositionY = currentPositionY;
    targetPositionY = currentPositionY;

    initialPinchDistance = -1;
    initialIndexFingerY = -1;
    initialIndexFingerX = -1;
    isPinching = false;
    pinchLostFrames = 0;
    pinchDistanceHistory = [];
    indexFingerYHistory = [];
    indexFingerXHistory = [];

    if (model) {
      model.traverse((c) => {
        if (!c.isMesh || !c.material) return;
        let parent = c;
        while (parent) {
          if (parent === closeButtonMesh) return;
          parent = parent.parent;
        }
        c.material.color.set(0xffffff);
        c.material.transparent = true;
        c.material.opacity = 0.3;
        c.material.emissive = new THREE.Color(0xffffff);
        c.material.emissiveIntensity = 0.1;
        c.material.needsUpdate = true;
      });
    }

    if (closeButtonMesh) {
      closeButtonMesh.visible = true;
      closeButtonMesh.traverse((c) => {
        if (c.isMesh && c.material) {
          c.material.transparent = false;
          c.material.opacity = 1.0;
          c.material.needsUpdate = true;
        }
        if (c.name === 'squareOutline') c.visible = true;
      });
    }
  } else {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (model) {
      model.rotation.x = THREE.MathUtils.degToRad(15);
      model.rotation.z = 0;
      model.position.z = 0;
      faceRollCurrent = 0;
      facePitchCurrent = 0;
      faceDepthCurrent = 0;

      model.traverse((c) => {
        if (!c.isMesh || !c.material || !originalMaterials.has(c)) return;
        const original = originalMaterials.get(c);
        c.material.color.copy(original.color);
        c.material.opacity = original.opacity;
        c.material.transparent = original.transparent;
        c.material.emissive.copy(original.emissive || new THREE.Color(0x000000));
        c.material.emissiveIntensity = original.emissiveIntensity || 0;
        c.material.needsUpdate = true;

        c.children.forEach((child) => {
          if (child.name === 'wireframeOverlay') {
            child.geometry.dispose();
            c.remove(child);
          }
        });
      });
      applyModelOpacityFactor();
    }

    if (closeButtonMesh) {
      closeButtonMesh.visible = false;
      closeButtonMesh.traverse((c) => {
        if (c.name === 'squareOutline') c.visible = false;
      });
    }
  }
}

function maybeRequestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    if (!pushSubscriptionReady) {
      ensurePushSubscription()
        .then((ok) => { pushSubscriptionReady = Boolean(ok); })
        .catch((err) => console.warn('Push subscription failed:', err));
    }
    return;
  }
  if (notificationPermissionRequested) return;
  if (Notification.permission !== 'default') return;
  notificationPermissionRequested = true;
  Notification.requestPermission()
    .then((permission) => {
      if (permission === 'granted') {
        return ensurePushSubscription()
          .then((ok) => { pushSubscriptionReady = Boolean(ok); })
          .catch((err) => console.warn('Push subscription failed:', err));
      }
      return null;
    })
    .catch((err) => {
      console.warn('Notification permission request failed:', err);
    });
}

async function showWaterNotification() {
  console.groupCollapsed('[NotifyDiag] precheck');
  console.log('origin:', window.location.origin);
  console.log('protocol:', window.location.protocol);
  console.log('visibilityState:', document.visibilityState);
  console.log('hasFocus:', document.hasFocus());
  console.log('navigator.onLine:', navigator.onLine);
  console.log('Notification API available:', typeof Notification !== 'undefined');
  if (typeof Notification !== 'undefined') {
    console.log('Notification.permission:', Notification.permission);
    console.log('Notification.maxActions:', Notification.maxActions ?? null);
  }
  console.groupEnd();

  if (typeof Notification === 'undefined') {
    console.warn('[NotifyDiag] Notification API unsupported in this browser.');
    return;
  }
  if (Notification.permission !== 'granted') {
    console.warn('[NotifyDiag] Notification permission is not granted.', {
      permission: Notification.permission
    });
    if (Notification.permission === 'default') maybeRequestNotificationPermission();
    return;
  }

  const tpl = window.__APP_NOTIFICATION_TEMPLATE__ || {};
  const title = tpl.title || 'Bado';
  const message = tpl.message || 'Dry lag raha hai tu';
  const imageUrl = tpl.imageUrl || undefined;
  const clickUrl = tpl.clickUrl || window.location.origin;
  const options = {
    body: message,
    icon: imageUrl,
    image: imageUrl,
    data: { url: clickUrl },
    tag: 'bado-water-reminder',
    renotify: true,
    requireInteraction: true
  };

  console.info('[NotifyDiag] Triggering notification', {
    title,
    message,
    imageUrl: imageUrl || null,
    clickUrl
  });

  try {
    let deliveredByServiceWorker = false;
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.showNotification) {
        console.info('[NotifyDiag] SW registration found', {
          scope: reg.scope,
          activeScriptURL: reg.active?.scriptURL || null
        });
        await reg.showNotification(title, options);
        console.info('[NotifyDiag] serviceWorker.showNotification sent');
        deliveredByServiceWorker = true;
        if (reg.getNotifications) {
          const shown = await reg.getNotifications({ tag: 'bado-water-reminder' });
          console.info('[NotifyDiag] getNotifications(tag=bado-water-reminder)', {
            count: shown.length
          });
        }
      } else {
        console.warn('[NotifyDiag] No service worker registration with showNotification available.');
      }
    } else {
      console.warn('[NotifyDiag] serviceWorker not available on navigator.');
    }

    if (!deliveredByServiceWorker) {
      const notification = new Notification(title, options);
      console.info('[NotifyDiag] Notification() constructor fallback sent');
      notification.onclick = () => {
        try {
          window.focus();
          window.location.href = clickUrl;
        } catch (err) {
          console.warn('Notification click navigation failed:', err);
        }
      };
      notification.onerror = (event) => {
        console.warn('[NotifyDiag] Notification instance onerror fired', event);
      };
      notification.onshow = () => {
        console.info('[NotifyDiag] Notification instance onshow fired');
      };
    }
  } catch (err) {
    console.warn('[NotifyDiag] Notification send flow failed:', err);
    try {
      const notification = new Notification(title, options);
      console.info('[NotifyDiag] Notification() constructor recovery sent');
      notification.onclick = () => {
        try {
          window.focus();
          window.location.href = clickUrl;
        } catch (clickErr) {
          console.warn('Notification click navigation failed:', clickErr);
        }
      };
    } catch (fallbackErr) {
      console.warn('[NotifyDiag] Notification constructor fallback failed:', fallbackErr);
    }
  }
}

function handleWaterModeStopEffects(source) {
  if (source === 'timeout') {
    gestureWaterExitStreak = 0;
    modelOpacityFactor = THREE.MathUtils.clamp(
      modelOpacityFactor * OPACITY_PENALTY_FACTOR,
      MIN_OPACITY_FACTOR,
      MAX_OPACITY_FACTOR
    );
  } else if (source === 'gesture') {
    gestureWaterExitStreak += 1;
    if (gestureWaterExitStreak >= 3) {
      modelOpacityFactor = THREE.MathUtils.clamp(
        modelOpacityFactor * OPACITY_REWARD_FACTOR,
        MIN_OPACITY_FACTOR,
        MAX_OPACITY_FACTOR
      );
      gestureWaterExitStreak = 0;
    }
  } else {
    gestureWaterExitStreak = 0;
  }
  applyModelOpacityFactor();
  savePersistentWaterState();
}

function ensureWaterTestControls() {
  if (waterTestControls) return waterTestControls;
  const wrap = document.createElement('div');
  wrap.id = 'waterTestControls';
  wrap.style.cssText = [
    'position: fixed',
    'left: 20px',
    'top: 20px',
    'display: flex',
    'gap: 8px',
    'z-index: 2300'
  ].join(';');

  const onBtn = document.createElement('button');
  onBtn.type = 'button';
  onBtn.textContent = 'Water ON';
  onBtn.style.cssText = [
    'border: 0',
    'border-radius: 8px',
    'padding: 8px 12px',
    'font-weight: 700',
    'font-size: 12px',
    'cursor: pointer',
    'background: #1976d2',
    'color: #fff'
  ].join(';');
  onBtn.addEventListener('click', () => {
    maybeRequestNotificationPermission();
    startWaterMode('manual-test');
  });

  const offBtn = document.createElement('button');
  offBtn.type = 'button';
  offBtn.textContent = 'Water OFF';
  offBtn.style.cssText = [
    'border: 0',
    'border-radius: 8px',
    'padding: 8px 12px',
    'font-weight: 700',
    'font-size: 12px',
    'cursor: pointer',
    'background: #455a64',
    'color: #fff'
  ].join(';');
  offBtn.addEventListener('click', () => stopWaterMode('timeout'));

  wrap.appendChild(onBtn);
  wrap.appendChild(offBtn);
  document.body.appendChild(wrap);
  waterTestControls = wrap;
  return waterTestControls;
}

function playWaterSoundPattern() {
  if (!waterAudioContext) return;
  const now = waterAudioContext.currentTime;
  const osc = waterAudioContext.createOscillator();
  const gain = waterAudioContext.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(250, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + 0.35);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  osc.connect(gain);
  gain.connect(waterAudioContext.destination);
  osc.start(now);
  osc.stop(now + 0.45);
}

function startWaterAudio() {
  if (!waterLoopAudio) {
    waterLoopAudio = new Audio(WATER_AUDIO_PATH);
    waterLoopAudio.loop = true;
    waterLoopAudio.preload = 'auto';
  }
  waterLoopAudio.currentTime = 0;
  waterLoopAudio.play().catch(() => {
    // Fallback to generated alert if browser blocks media or file is missing.
    try {
      if (!waterAudioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        waterAudioContext = new Ctx();
      }
      waterAudioContext.resume().catch(() => {});
      if (waterAudioInterval) clearInterval(waterAudioInterval);
      playWaterSoundPattern();
      waterAudioInterval = setInterval(playWaterSoundPattern, 1200);
    } catch (err) {
      console.warn('Water alert sound could not be started:', err);
    }
  });
}

function stopWaterAudio() {
  if (waterLoopAudio) {
    waterLoopAudio.pause();
    waterLoopAudio.currentTime = 0;
  }
  try {
    if (waterAudioInterval) {
      clearInterval(waterAudioInterval);
      waterAudioInterval = null;
    }
  } catch (err) {
    console.warn('Failed to stop fallback water alert sound:', err);
  }
}

function startWaterMode(slotKey = null, endsAt = null) {
  if (waterModeActive) return;
  if (overlayActive) toggleOverlay();
  waterModeActive = true;
  waterModeEndsAt = endsAt || (Date.now() + WATER_MODE_DURATION_MS);
  waterStopHoldFrames = 0;
  if (slotKey) consumedWaterSlots.add(slotKey);
  if (waterModeTimeout) clearTimeout(waterModeTimeout);
  waterModeTimeout = setTimeout(() => stopWaterMode('timeout'), Math.max(0, waterModeEndsAt - Date.now()));
  showWaterNotification();
  startWaterAudio();
  if (currentModelPath !== WATER_MODEL_PATH) loadModel(WATER_MODEL_PATH);
  gestureIndicator.classList.add('active');
  gestureIndicator.textContent = 'Water Mode Active';
}

function stopWaterMode(source = 'manual') {
  if (!waterModeActive) return;
  waterModeActive = false;
  handleWaterModeStopEffects(source);
  waterStopHoldFrames = 0;
  waterModeEndsAt = 0;
  if (waterModeTimeout) {
    clearTimeout(waterModeTimeout);
    waterModeTimeout = null;
  }
  stopWaterAudio();
  if (currentModelPath !== DEFAULT_MODEL_PATH) loadModel(DEFAULT_MODEL_PATH);
  gestureIndicator.classList.remove('active');
  gestureIndicator.textContent = source === 'timeout' ? 'Water mode completed' : 'Water mode stopped';
}

function getWaterSlotKey(date, slot) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}_${slot.label}`;
}

function checkScheduledWaterMode() {
  const now = new Date();
  for (const slot of WATER_MODE_SLOTS) {
    const slotStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      slot.hour,
      slot.minute,
      0,
      0
    );
    const slotEnd = new Date(slotStart.getTime() + WATER_MODE_DURATION_MS);
    const slotKey = getWaterSlotKey(now, slot);
    if (now >= slotEnd) {
      consumedWaterSlots.add(slotKey);
      continue;
    }
    if (now >= slotStart && now < slotEnd && !consumedWaterSlots.has(slotKey) && !waterModeActive) {
      startWaterMode(slotKey, slotEnd.getTime());
      return;
    }
  }
}

function initWaterModeScheduler() {
  checkScheduledWaterMode();
  if (waterScheduleTimer) clearInterval(waterScheduleTimer);
  waterScheduleTimer = setInterval(checkScheduledWaterMode, WATER_SCHEDULE_CHECK_MS);
}

function initNotificationPermissionHooks() {
  const handleFirstInteraction = () => maybeRequestNotificationPermission();
  document.addEventListener('pointerdown', handleFirstInteraction, { once: true });
  document.addEventListener('keydown', handleFirstInteraction, { once: true });
}

/* DETECTION LOOP */
function startDetection() {
  async function detectLoop() {
    if (video.readyState >= 2) {
      const currentTime = video.currentTime;
      const now = performance.now();
      if (now - lastProcessTime < PROCESS_INTERVAL) {
        requestAnimationFrame(detectLoop);
        return;
      }
      lastProcessTime = now;

      if (currentTime !== lastVideoTime) {
        lastVideoTime = currentTime;

        if (gestureRecognizer) {
            const gestureResults = gestureRecognizer.recognizeForVideo(video, performance.now());
            if (gestureResults.gestures && gestureResults.gestures.length > 0) {
              const topGesture = gestureResults.gestures[0][0];
              const handLandmarks = gestureResults.landmarks[0];
              const isOpenPalm = topGesture.categoryName === 'Open_Palm' && topGesture.score > 0.45;
              const isWaterStopGesture = topGesture.categoryName === 'Closed_Fist' && topGesture.score > 0.45;

              if (waterModeActive && isWaterStopGesture) {
                waterStopHoldFrames++;
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                gestureIndicator.classList.add('active');
                gestureIndicator.textContent = `Water Stop ${waterStopHoldFrames}/${WATER_STOP_HOLD_THRESHOLD}`;
                if (waterStopHoldFrames >= WATER_STOP_HOLD_THRESHOLD) {
                  stopWaterMode('gesture');
                }
              } else if (!waterModeActive && isOpenPalm) {
                waterStopHoldFrames = 0;
                consecutivePalmDetections++;
                overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                gestureIndicator.classList.add('active');
                gestureIndicator.textContent = `Palm ${topGesture.score.toFixed(2)}`;

                if (consecutivePalmDetections >= REQUIRED_CONSECUTIVE_DETECTIONS) {
                  palmHoldFrames++;
                  gestureIndicator.textContent = `Palm ${palmHoldFrames}/${PALM_HOLD_THRESHOLD} (${topGesture.score.toFixed(2)})`;
                  if (palmHoldFrames >= PALM_HOLD_THRESHOLD) {
                    toggleOverlay();
                    palmHoldFrames = 0;
                    consecutivePalmDetections = 0;
                    gestureIndicator.textContent = 'Mode Toggled';
                  }
                }
              } else if (overlayActive && handLandmarks && topGesture.categoryName !== 'Open_Palm') {
                waterStopHoldFrames = 0;
                const pinchData = detectPinchGesture(handLandmarks);
                if (pinchData) {
                  handlePinchControl(pinchData, handLandmarks);
                }
              } else {
                waterStopHoldFrames = 0;
                clearGestureState();
              }
            } else {
              waterStopHoldFrames = 0;
              clearGestureState();
              resetPinchTracking();
            }
          }

          if (faceLandmarker && !overlayActive) {
            const faceResults = faceLandmarker.detectForVideo(video, performance.now());
            if (!faceResults.faceLandmarks || faceResults.faceLandmarks.length === 0) {
              lostFrames++;
              if (lostFrames > 15) isTracking = false;
            } else {
              const hadTracking = isTracking;
              lostFrames = 0;
              isTracking = true;
              const lm = faceResults.faceLandmarks[0];

              const nose = lm[1];
              const nx = (nose.x - 0.5) * 2;
              const ny = (nose.y - 0.5) * 2;
              const measuredEyeX = THREE.MathUtils.clamp(Math.tanh(nx * 5), -1, 1);
              const measuredEyeY = THREE.MathUtils.clamp(Math.tanh(ny * 8), -1, 1);
              if (!hadTracking) {
                eyeTrackedX = measuredEyeX;
                eyeTrackedY = measuredEyeY;
              } else {
                eyeTrackedX += (measuredEyeX - eyeTrackedX) * EYE_INPUT_SMOOTHING;
                eyeTrackedY += (measuredEyeY - eyeTrackedY) * EYE_INPUT_SMOOTHING;
              }

              const dx = lm[263].x - lm[33].x;
              const dy = lm[263].y - lm[33].y;
              const measuredRoll = THREE.MathUtils.radToDeg(Math.atan2(dy, dx));
              if (!hadTracking) {
                faceRoll = measuredRoll;
              } else {
                faceRoll += (measuredRoll - faceRoll) * ROLL_INPUT_SMOOTHING;
              }
              if (Math.abs(faceRoll) < ROLL_DEADZONE_DEG) faceRoll = 0;

              const faceHeight = lm[152].y - lm[10].y;
              if (neutralHeight === null) neutralHeight = faceHeight;
              const rawPitch = (faceHeight - neutralHeight) * 300 * -1;
              // Reduce false "looking down/up" caused by strong left/right head roll.
              const rollCoupling = THREE.MathUtils.clamp(Math.abs(faceRoll) / 30, 0, 1);
              const measuredPitch = rawPitch * (1 - 0.45 * rollCoupling);
              if (!hadTracking) {
                facePitch = measuredPitch;
              } else {
                facePitch += (measuredPitch - facePitch) * PITCH_INPUT_SMOOTHING;
              }

              const eyeDist = Math.hypot(dx, dy);
              rawEyeDist = eyeDist;
              if (baselineEyeDist === null && !inceptionCaptured) baselineEyeDist = eyeDist;

              const top = lm[13];
              const bottom = lm[14];
              mouthOpen = THREE.MathUtils.clamp((bottom.y - top.y) * 20, 0, 1);
            }
          } else if (overlayActive) {
            isTracking = false;
          }
      }
    }

    requestAnimationFrame(detectLoop);
  }

  detectLoop();
}

function clearGestureState() {
  if (waterModeActive) return;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (consecutivePalmDetections > 0) consecutivePalmDetections--;
  if (consecutivePalmDetections === 0) {
    palmHoldFrames = 0;
    gestureIndicator.classList.remove('active');
    gestureIndicator.textContent = 'Palm Detected!';
  }
}

function resetPinchTracking() {
  initialPinchDistance = -1;
  initialIndexFingerY = -1;
  initialIndexFingerX = -1;
  isPinching = false;
  pinchLostFrames = 0;
  pinchDistanceHistory = [];
  indexFingerYHistory = [];
  indexFingerXHistory = [];
}

function handlePinchControl(pinchData, handLandmarks) {
  const thumbX = pinchData.thumbTip.x * overlayCanvas.width;
  const thumbY = pinchData.thumbTip.y * overlayCanvas.height;
  const indexX = pinchData.indexTip.x * overlayCanvas.width;
  const indexY = pinchData.indexTip.y * overlayCanvas.height;
  const pixelDistance = Math.hypot(indexX - thumbX, indexY - thumbY);
  const pinchPixelThreshold = isPinching ? 40 : 30;

  if (pixelDistance >= pinchPixelThreshold) {
    pinchLostFrames++;
    if (pinchLostFrames > PINCH_LOST_THRESHOLD) {
      resetPinchTracking();
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    return;
  }

  isPinching = true;
  pinchLostFrames = 0;
  consecutivePalmDetections = 0;
  palmHoldFrames = 0;

  const smoothedDistance = getSmoothedPinchDistance(
    pinchDistanceHistory,
    pinchData.distance,
    PINCH_HISTORY_SIZE
  );
  if (initialPinchDistance === -1) initialPinchDistance = smoothedDistance;
  const scaleRatio = smoothedDistance / initialPinchDistance;
  const clampedRatio = THREE.MathUtils.clamp(scaleRatio, MIN_SCALE_RATIO, MAX_SCALE_RATIO);
  targetScale = baselineScale * clampedRatio;

  const indexFingerY = handLandmarks[8].y;
  const indexFingerX = handLandmarks[8].x;
  const smoothedY = getSmoothedFingerPos(indexFingerYHistory, indexFingerY, FINGER_HISTORY_SIZE);
  const smoothedX = getSmoothedFingerPos(indexFingerXHistory, indexFingerX, FINGER_HISTORY_SIZE);
  if (initialIndexFingerY === -1) initialIndexFingerY = smoothedY;
  if (initialIndexFingerX === -1) initialIndexFingerX = smoothedX;

  const deltaY = smoothedY - initialIndexFingerY;
  const rotationAmount = deltaY * 8;
  targetRotationY = THREE.MathUtils.clamp(baselineRotationY + rotationAmount, -MAX_ROTATION, MAX_ROTATION);

  const deltaX = smoothedX - initialIndexFingerX;
  const positionAmount = -deltaX * 10;
  if (IS_MOBILE_DEVICE) {
    targetPositionY = THREE.MathUtils.clamp(baselinePositionY + positionAmount, MIN_POSITION_Y, MAX_POSITION_Y);
  } else {
    targetPositionX = THREE.MathUtils.clamp(baselinePositionX + positionAmount, -MAX_POSITION_X, MAX_POSITION_X);
  }

  drawPinchVisualization(thumbX, thumbY, indexX, indexY);
  const scalePercent = ((targetScale / baselineScale) * 100).toFixed(0);
  const rotationDeg = (currentRotationY * 180 / Math.PI).toFixed(0);
  const positionX = currentPositionX.toFixed(1);
  const positionY = currentPositionY.toFixed(1);
  gestureIndicator.classList.add('active');
  gestureIndicator.textContent = IS_MOBILE_DEVICE
    ? `Scale: ${scalePercent}% | Rot: ${rotationDeg} | Y: ${positionY}`
    : `Scale: ${scalePercent}% | Rot: ${rotationDeg} | Pos: ${positionX}`;
}

function drawPinchVisualization(thumbX, thumbY, indexX, indexY) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.strokeStyle = '#4CAF50';
  overlayCtx.lineWidth = 3;
  overlayCtx.beginPath();
  overlayCtx.moveTo(thumbX, thumbY);
  overlayCtx.lineTo(indexX, indexY);
  overlayCtx.stroke();

  overlayCtx.fillStyle = '#4CAF50';
  overlayCtx.beginPath();
  overlayCtx.arc(thumbX, thumbY, 6, 0, 2 * Math.PI);
  overlayCtx.fill();
  overlayCtx.beginPath();
  overlayCtx.arc(indexX, indexY, 6, 0, 2 * Math.PI);
  overlayCtx.fill();
}

/* AVATAR UPDATE */
function updateMouth(delta) {
  if (!lipsMesh || !mouthMesh) return;
  if (isTracking) {
    const trackedMouth = mouthOpen;
    const mouthLerp = 1 - Math.exp(-delta / Math.max(1e-6, SMOOTH_TIME_MOUTH));
    mouthCurrent += (trackedMouth - mouthCurrent) * mouthLerp;
  }

  const v = THREE.MathUtils.smoothstep(mouthCurrent, 0.08, 0.65);
  const shapes = ['BMP', 'hmmm', 'O', 'Nooo', 'Ohhhh', 'ANGRY'];
  const f = v * (shapes.length - 1);
  const base = Math.floor(f);
  const next = Math.min(base + 1, shapes.length - 1);
  const blend = f - base;
  applyBlend(lipsMesh, shapes[base], shapes[next], blend);
  applyBlend(mouthMesh, shapes[base], shapes[next], blend);
}

function applyBlend(mesh, a, b, t) {
  const d = mesh.morphTargetDictionary;
  const i = mesh.morphTargetInfluences;
  if (!d || !i) return;
  i.fill(0);
  if (d[a] != null) i[d[a]] = 1 - t;
  if (d[b] != null) i[d[b]] = t;
}

function updateFaceShape() {
  if (!faceMesh) return;
  const d = faceMesh.morphTargetDictionary;
  const i = faceMesh.morphTargetInfluences;
  if (!d || !i) return;
  const v = mouthCurrent;
  i.fill(0);
  if (v < 0.25) {
    if (d.normal != null) i[d.normal] = 1;
  } else if (v < 0.55) {
    const t = (v - 0.25) / 0.30;
    if (d.normal != null) i[d.normal] = 1 - t;
    if (d['wide stretch'] != null) i[d['wide stretch']] = t;
  } else {
    const t = (v - 0.55) / 0.45;
    if (d['wide stretch'] != null) i[d['wide stretch']] = 1 - t;
    if (d['long stretch'] != null) i[d['long stretch']] = t;
  }
}

function updateEars() {
  if (!isTracking && !overlayActive) return;
  const v = THREE.MathUtils.clamp(facePitchCurrent / 25, -1, 1);

  function apply(mesh) {
    if (!mesh) return;
    const d = mesh.morphTargetDictionary;
    const i = mesh.morphTargetInfluences;
    if (!d || !i) return;
    i.fill(0);
    if (Math.abs(v) < 0.15) {
      if (d.normal != null) i[d.normal] = 1;
      return;
    }
    if (v > 0) {
      if (d.up != null) i[d.up] = Math.min(v, 1);
    } else {
      if (d.down != null) i[d.down] = Math.min(-v, 1);
    }
  }

  apply(leftEar);
  apply(rightEar);
}

function updateWireframes() {
  if (!overlayActive || !model) return;
  model.traverse((c) => {
    if (!c.isMesh || !c.geometry) return;
    let wireframeMesh = c.children.find((child) => child.name === 'wireframeOverlay');

    if (c.morphTargetInfluences && c.morphTargetInfluences.some((influence) => influence > 0)) {
      if (wireframeMesh) {
        wireframeMesh.geometry.dispose();
        c.remove(wireframeMesh);
      }
      const morphedGeometry = c.geometry.clone();
      if (morphedGeometry.morphAttributes.position) {
        const basePositions = morphedGeometry.attributes.position.array;
        const morphPositions = morphedGeometry.morphAttributes.position;
        for (let i = 0; i < c.morphTargetInfluences.length; i++) {
          const influence = c.morphTargetInfluences[i];
          if (influence !== 0 && morphPositions[i]) {
            const morphData = morphPositions[i].array;
            for (let j = 0; j < basePositions.length; j++) {
              basePositions[j] += morphData[j] * influence;
            }
          }
        }
        morphedGeometry.attributes.position.needsUpdate = true;
      }
      const wireframeGeometry = new THREE.EdgesGeometry(morphedGeometry, 15);
      const wireframeMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        depthTest: true
      });
      wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
      wireframeMesh.name = 'wireframeOverlay';
      c.add(wireframeMesh);
      morphedGeometry.dispose();
    } else if (!wireframeMesh) {
      const wireframeGeometry = new THREE.EdgesGeometry(c.geometry, 15);
      const wireframeMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        depthTest: true
      });
      wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
      wireframeMesh.name = 'wireframeOverlay';
      c.add(wireframeMesh);
    }
  });
}

function updateEyes(delta, elapsedTime) {
  if (!leftPupil || !rightPupil) return;
  const idleX = Math.sin(elapsedTime * 1.1) * 0.35;
  const idleY = Math.sin(elapsedTime * 0.6) * 0.25;
  const trackedX = isTracking ? eyeTrackedX : idleX;
  const trackedY = isTracking ? eyeTrackedY : idleY;
  const tx = trackedX;
  const ty = trackedY;
  const eyeLerp = 1 - Math.exp(-delta / Math.max(1e-6, SMOOTH_TIME_EYE));
  eyeCurrentX += (tx - eyeCurrentX) * eyeLerp;
  eyeCurrentY += (ty - eyeCurrentY) * eyeLerp;
  updatePupil(leftPupil, eyeCurrentX, eyeCurrentY);
  updatePupil(rightPupil, eyeCurrentX, eyeCurrentY);
}

function updatePupil(mesh, nx, ny) {
  const d = mesh.morphTargetDictionary;
  const i = mesh.morphTargetInfluences;
  if (!d || !i) return;
  i.fill(0);
  if (Math.abs(nx) < 0.05 && Math.abs(ny) < 0.05) {
    if (d.centre != null) i[d.centre] = 1;
    return;
  }
  if (nx > 0 && d.right != null) i[d.right] = Math.min(nx, 1);
  if (nx < 0 && d.left != null) i[d.left] = Math.min(-nx, 1);
  if (ny > 0 && d.bottom != null) i[d.bottom] = Math.min(ny, 1);
  if (ny < 0 && d.top != null) i[d.top] = Math.min(-ny, 1);
}

/* RENDER LOOP */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  updateEyes(delta, elapsed);
  updateMouth(delta);
  updateFaceShape();
  updateEars();

  const smoothTime = overlayActive ? SMOOTH_TIME_EDIT : SMOOTH_TIME_NORMAL;
  const lerp = 1 - Math.exp(-delta / Math.max(1e-6, smoothTime));
  currentScale += (targetScale - currentScale) * lerp;
  currentRotationY += (targetRotationY - currentRotationY) * lerp;
  currentPositionX += (targetPositionX - currentPositionX) * lerp;
  currentPositionY += (targetPositionY - currentPositionY) * lerp;

  if (model) {
    model.scale.set(currentScale, currentScale, currentScale);
    model.rotation.y = currentRotationY;
    model.position.x = currentPositionX;
    model.position.y = modelBaseY + currentPositionY;
  }

  if (overlayActive) updateWireframes();

  if (model && isTracking && !overlayActive) {
    const trackLerp = 1 - Math.exp(-delta / Math.max(1e-6, SMOOTH_TIME_FACE_TRACK));
    const rollLerp = 1 - Math.exp(-delta / Math.max(1e-6, SMOOTH_TIME_FACE_ROLL));
    if (rawEyeDist !== null && baselineEyeDist !== null) {
      if (smoothedEyeDist === null) smoothedEyeDist = rawEyeDist;
      const eyeDistLerp = 1 - Math.exp(-delta / Math.max(1e-6, EYE_DIST_SMOOTH_TIME));
      smoothedEyeDist += (rawEyeDist - smoothedEyeDist) * eyeDistLerp;
      if (!inceptionCaptured) {
        faceDepth = (baselineEyeDist - 0.13) * 40;
        faceDepth = THREE.MathUtils.clamp(faceDepth, -2.5, 1.8);
        inceptionCaptured = true;
      } else {
        const depthChange = (smoothedEyeDist - baselineEyeDist) * 40;
        faceDepth = (baselineEyeDist - 0.13) * 40 + depthChange;
        faceDepth = THREE.MathUtils.clamp(faceDepth, -2.5, 1.8);
      }
    }

    faceRollCurrent += (faceRoll - faceRollCurrent) * rollLerp;
    facePitchCurrent += (facePitch - facePitchCurrent) * trackLerp;
    faceDepthCurrent += (faceDepth - faceDepthCurrent) * trackLerp;

    model.rotation.z = THREE.MathUtils.degToRad(faceRollCurrent);
    model.rotation.x = THREE.MathUtils.degToRad(15 + facePitchCurrent);
    model.position.z = faceDepthCurrent;
  }

  if (mixer) {
    mixer.update(delta);
    if (mixer.time < start || mixer.time > end) mixer.setTime(start);
  }

  renderer.render(scene, camera);
}

initNotificationPermissionHooks();
initFaceAuthGate();
animate();

export {
  THREE,
  scene,
  camera,
  renderer,
  model,
  mixer,
  toggleOverlay,
  initMediaPipe,
  startAuthorizedTracking
};
