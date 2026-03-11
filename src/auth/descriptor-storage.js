export function float32ToBase64(arr) {
  const u8 = new Uint8Array(arr.buffer);
  let binary = '';
  for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
  return btoa(binary);
}

export function base64ToFloat32(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

export function saveEnrollmentBlob(b64) {
  localStorage.setItem('face_enroll_blob', b64);
}

export function loadEnrollmentBlob() {
  return localStorage.getItem('face_enroll_blob');
}

export function clearEnrollmentBlob() {
  localStorage.removeItem('face_enroll_blob');
}

export function saveEnrollmentCount(n) {
  localStorage.setItem('face_enroll_count', String(n));
}

export function loadEnrollmentCount() {
  const v = localStorage.getItem('face_enroll_count');
  return v ? parseInt(v, 10) : 0;
}

export function clearEnrollmentCount() {
  localStorage.removeItem('face_enroll_count');
}