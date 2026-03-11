export function detectPinchGesture(landmarks) {
  if (!landmarks || landmarks.length !== 21) return null;

  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];

  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  const dz = thumbTip.z - indexTip.z;
  const pinchDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    distance: pinchDistance,
    thumbTip,
    indexTip
  };
}

export function getSmoothedPinchDistance(history, currentDistance, historySize) {
  history.push(currentDistance);
  if (history.length > historySize) history.shift();
  const sum = history.reduce((a, b) => a + b, 0);
  return sum / history.length;
}

export function getSmoothedFingerPos(history, currentVal, historySize) {
  history.push(currentVal);
  if (history.length > historySize) history.shift();
  return history.reduce((a, b) => a + b, 0) / history.length;
}