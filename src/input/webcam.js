export async function initWebcam(videoEl) {
  const existingStream = videoEl?.srcObject;
  if (existingStream && existingStream.getTracks().some((track) => track.readyState === 'live')) {
    console.log('[TrackingDiag] Reusing existing webcam stream.');
    await videoEl.play().catch(() => {});
    return existingStream;
  }

  let stream;
  const isMobileDevice = /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
  const exactFrontConstraints = {
    video: {
      facingMode: { exact: 'user' },
      width: { ideal: isMobileDevice ? 480 : 640 },
      height: { ideal: isMobileDevice ? 360 : 480 },
      frameRate: { ideal: isMobileDevice ? 24 : 30, max: isMobileDevice ? 24 : 30 }
    },
    audio: false
  };
  const preferredConstraints = {
    video: {
      facingMode: { ideal: 'user' },
      width: { ideal: isMobileDevice ? 480 : 640 },
      height: { ideal: isMobileDevice ? 360 : 480 },
      frameRate: { ideal: isMobileDevice ? 24 : 30, max: isMobileDevice ? 24 : 30 }
    },
    audio: false
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia(exactFrontConstraints);
    console.log('[TrackingDiag] Webcam stream started with exact front-camera constraints.');
  } catch (exactFrontError) {
    console.warn('[TrackingDiag] Exact front-camera request failed, trying preferred front camera.', exactFrontError);
  }

  try {
    if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia(preferredConstraints);
    console.log('[TrackingDiag] Webcam stream started with preferred constraints.');
    }
  } catch (preferredError) {
    console.warn('[TrackingDiag] Preferred front-camera request failed, falling back to generic video.', preferredError);
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    console.log('[TrackingDiag] Webcam stream started with fallback constraints.');
  }

  videoEl.autoplay = true;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});
  const track = stream.getVideoTracks?.()[0];
  const settings = track?.getSettings?.();
  console.log('[TrackingDiag] Webcam video ready.', {
    ...(settings || {}),
    label: track?.label || 'unknown'
  });
  return stream;
}
