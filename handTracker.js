/**
 * Hand tracker using MediaPipe Hands.
 * Tracks both hands and detects pinch gesture (thumb + index tip close).
 * Pinch position is used for drawing in place of mouse.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe hand landmark indices
const THUMB_TIP = 4;
const INDEX_TIP = 8;

// Pinch threshold (normalized distance 0–1). Smaller = tighter pinch.
const PINCH_THRESHOLD = 0.12;

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let handLandmarker = null;
let videoElement = null;
let lastVideoTime = -1;
let opening = null;
let state = {
  isPinching: false,
  pinchX: 0.5,
  pinchY: 0.5,
  pointerX: 0.5,
  pointerY: 0.5,
  pinchDistance: 1,
  handsSeen: false,
  ready: false,
  error: null
};

function isInfraredCamera(label) {
  return /infrared|\bIR\b|depth|windows hello/i.test(label || '');
}

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

function trackIsLive(stream) {
  const track = stream?.getVideoTracks?.()[0];
  return !!track && track.readyState === 'live';
}

let cameraThumbnailOn = true;
let framePump = null;

function placeVideo(video) {
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.autoplay = true;
  if (cameraThumbnailOn) {
    video.style.cssText = 'position:fixed;left:16px;bottom:16px;width:240px;height:180px;opacity:1;visibility:visible;display:block;object-fit:cover;transform:scaleX(-1);pointer-events:none;z-index:1000;background:#111;border-radius:8px;';
  } else {
    // Fully hidden. The element stays large enough for the camera to keep sending frames.
    video.style.cssText = 'position:fixed;left:0;top:0;width:240px;height:180px;opacity:0;visibility:hidden;display:block;pointer-events:none;z-index:-1;object-fit:cover;transform:scaleX(-1);';
  }
}

export function pumpCameraFrame(video) {
  if (!video || video.readyState < 2) return;
  if (!framePump) {
    framePump = document.createElement('canvas');
    framePump.width = 8;
    framePump.height = 8;
  }
  framePump.getContext('2d').drawImage(video, 0, 0, 8, 8);
}

export function setCameraThumbnailVisible(visible) {
  cameraThumbnailOn = !!visible;
  if (videoElement) placeVideo(videoElement);
}

let reopenTimer = null;
function scheduleReopen() {
  if (reopenTimer || opening) return;
  state.ready = false;
  state.handsSeen = false;
  state.isPinching = false;
  state.error = 'Camera closed. Opening it again.';
  reopenTimer = setTimeout(() => {
    reopenTimer = null;
    initHandTracker();
  }, 400);
}

function cameraErrorMessage(err) {
  if (err?.name === 'NotAllowedError') {
    return 'Camera permission is blocked. Allow the camera for this page.';
  }
  if (err?.name === 'NotReadableError' || /in use/i.test(err?.message || '')) {
    return 'Camera is in use. Close the other window using the webcam.';
  }
  return err?.message || 'Hand tracker failed.';
}

async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput');
  } catch {
    return [];
  }
}

function colorCamera(cameras) {
  return cameras.find((camera) => camera.deviceId && camera.label && !isInfraredCamera(camera.label)) || null;
}

async function openColorCamera() {
  let lastError = null;

  for (let round = 0; round < 3; round++) {
    const cameras = await listCameras();
    const preferred = colorCamera(cameras);
    const attempts = [];
    if (preferred) {
      attempts.push({ video: { deviceId: { exact: preferred.deviceId } }, audio: false });
    }
    attempts.push({ video: true, audio: false });

    for (const constraints of attempts) {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        const track = stream.getVideoTracks()[0];
        const label = track?.label || '';
        if (isInfraredCamera(label)) {
          stopStream(stream);
          stream = null;
          const color = colorCamera(await listCameras());
          if (!color) throw new Error('Only the infrared camera is available');
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: color.deviceId } },
            audio: false,
          });
        }
        console.log('Hand camera:', stream.getVideoTracks()[0]?.label || 'camera');
        return stream;
      } catch (err) {
        stopStream(stream);
        lastError = err;
        if (err?.name === 'NotAllowedError') throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  throw lastError || new Error('Camera unavailable');
}

async function startHandTracker() {
  try {
    if (!handLandmarker) {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        numHands: 2,
        runningMode: 'VIDEO'
      });
    }

    const stream = await openColorCamera();
    if (!videoElement) {
      videoElement = document.createElement('video');
      document.body.appendChild(videoElement);
    } else if (videoElement.srcObject && videoElement.srcObject !== stream) {
      stopStream(videoElement.srcObject);
    }
    placeVideo(videoElement);
    videoElement.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    if (track) track.addEventListener('ended', scheduleReopen);
    await videoElement.play();

    state.ready = true;
    state.error = null;
    return { video: videoElement };
  } catch (err) {
    state.ready = false;
    state.error = cameraErrorMessage(err);
    console.warn('Hand tracker init failed:', err);
    return { video: null, error: state.error };
  }
}

/**
 * Initialize camera and HandLandmarker. Call once after user gesture if needed.
 * @returns {Promise<{video: HTMLVideoElement, error?: string}>}
 */
export async function initHandTracker() {
  if (trackIsLive(videoElement?.srcObject)) {
    state.ready = true;
    state.error = null;
    if (videoElement.paused) videoElement.play().catch(() => {});
    return { video: videoElement };
  }
  if (opening) return opening;
  opening = startHandTracker().finally(() => {
    opening = null;
  });
  return opening;
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && videoElement && trackIsLive(videoElement.srcObject)) {
      videoElement.play().catch(() => {});
    }
  });
}

/**
 * Update hand state from the current video frame. Call every frame from p5 draw().
 * @param {HTMLVideoElement} video
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {boolean} mirror - mirror X for front camera
 */
export function updateHandTracker(video, canvasWidth, canvasHeight, mirror = true) {
  const liveTrack = video?.srcObject?.getVideoTracks?.()[0];
  if (liveTrack && liveTrack.readyState === 'ended') {
    scheduleReopen();
    return;
  }

  if (video && video.paused) {
    video.play().catch(() => {});
  }

  if (!handLandmarker || !video || video.readyState < 2 || !canvasWidth || !canvasHeight) {
    state.isPinching = false;
    state.handsSeen = false;
    return;
  }

  const timeMs = performance.now();
  if (timeMs <= lastVideoTime) return;
  lastVideoTime = timeMs;

  try {
    const result = handLandmarker.detectForVideo(video, timeMs);
    state.isPinching = false;
    state.handsSeen = false;

    let closest = null;
    if (result.landmarks && result.landmarks.length > 0) {
      for (const landmarks of result.landmarks) {
        if (landmarks.length <= Math.max(THUMB_TIP, INDEX_TIP)) continue;
        const thumb = landmarks[THUMB_TIP];
        const index = landmarks[INDEX_TIP];
        const dx = thumb.x - index.x;
        const dy = thumb.y - index.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (!closest || dist < closest.dist) {
          closest = { dist, thumb, index };
        }
      }
    }

    if (closest) {
      state.handsSeen = true;
      state.pinchDistance = closest.dist;
      state.pointerX = closest.index.x;
      state.pointerY = closest.index.y;
      state.pinchX = (closest.thumb.x + closest.index.x) / 2;
      state.pinchY = (closest.thumb.y + closest.index.y) / 2;
      const releaseAt = PINCH_THRESHOLD + 0.06;
      state.isPinching = state.isPinching ? closest.dist < releaseAt : closest.dist < PINCH_THRESHOLD;
    }
  } catch (e) {
    state.isPinching = false;
    state.handsSeen = false;
  }
}

/**
 * Get current hand state for drawing.
 * Coordinates are normalized 0–1 (same space as video). Convert to canvas in sketch.
 */
export function getHandVideo() {
  return videoElement;
}

export function getHandState() {
  return {
    isPinching: state.isPinching,
    pinchX: state.pinchX,
    pinchY: state.pinchY,
    pointerX: state.pointerX,
    pointerY: state.pointerY,
    pinchDistance: state.pinchDistance,
    handsSeen: state.handsSeen,
    ready: state.ready,
    error: state.error
  };
}

// The on-screen camera is a 4:3 picture (object-fit: cover). Landmarks are
// measured on the full camera frame, which is wider, so the sides of that
// picture never reached the sides of the window.
const CAMERA_FRAME_ASPECT = 4 / 3;

function visibleCameraRect(videoWidth, videoHeight) {
  const videoAspect = videoWidth / videoHeight;
  if (videoAspect > CAMERA_FRAME_ASPECT) {
    const w = CAMERA_FRAME_ASPECT / videoAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = videoAspect / CAMERA_FRAME_ASPECT;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/**
 * Map a point in the camera picture onto the whole window.
 * The picture shown in the camera preview fills the window edge to edge.
 */
export function pinchToCanvas(pinchX, pinchY, width, height, mirror = true, video = null) {
  let x = mirror ? 1 - pinchX : pinchX;
  let y = pinchY;
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    const frame = visibleCameraRect(video.videoWidth, video.videoHeight);
    x = (x - frame.x) / frame.w;
    y = (y - frame.y) / frame.h;
  }
  return {
    x: x * width,
    y: y * height
  };
}

/** Pixel crop of the camera frame that the preview actually shows. */
export function cameraPreviewCrop(video) {
  if (!video || video.videoWidth < 1 || video.videoHeight < 1) return null;
  const frame = visibleCameraRect(video.videoWidth, video.videoHeight);
  return {
    sx: frame.x * video.videoWidth,
    sy: frame.y * video.videoHeight,
    sw: frame.w * video.videoWidth,
    sh: frame.h * video.videoHeight
  };
}

/**
 * Stop camera and cleanup.
 */
export function closeHandTracker() {
  if (videoElement && videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(t => t.stop());
    videoElement.srcObject = null;
  }
  if (videoElement && videoElement.parentNode) {
    videoElement.parentNode.removeChild(videoElement);
  }
  if (handLandmarker) {
    handLandmarker.close();
    handLandmarker = null;
  }
  videoElement = null;
  state = { isPinching: false, pinchX: 0.5, pinchY: 0.5, pointerX: 0.5, pointerY: 0.5, pinchDistance: 1, handsSeen: false, ready: false, error: null };
}
