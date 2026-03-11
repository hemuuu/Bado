import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const wwwDir = path.join(root, 'www');

const files = [
  'index.html',
  'style.css',
  'scene-core.js',
  'tracking-mode.js',
  'edit-mode.js',
  'faceauth.js',
  'mediapipe4.glb',
  'mediapipe4_water.glb',
  'water-drinking.mp3',
  'water-core.js',
  'water-mode.js',
  'water.glb',
  'OneSignalSDKWorker.js',
  'OneSignalSDKUpdaterWorker.js',
  'firebase-messaging-sw.js',
  'intro.mp3'
];

const dirs = [
  'src',
  'enrollment_data'
];

function resetDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFileIfExists(relPath) {
  const from = path.join(root, relPath);
  if (!fs.existsSync(from)) return;
  const to = path.join(wwwDir, relPath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDirIfExists(relPath) {
  const from = path.join(root, relPath);
  if (!fs.existsSync(from)) return;
  const to = path.join(wwwDir, relPath);
  fs.cpSync(from, to, { recursive: true, force: true });
}

resetDir(wwwDir);
files.forEach(copyFileIfExists);
dirs.forEach(copyDirIfExists);

console.log('www prepared for Capacitor Android.');
