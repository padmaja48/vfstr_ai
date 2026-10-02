import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import * as blazeface from '@tensorflow-models/blazeface';

let modelPromise = null;

const initBackend = async () => {
  try {
    await tf.setBackend('webgl');
  } catch {
    // WebGL unavailable (some locked-down browsers) — CPU still works, just slower.
    await tf.setBackend('cpu');
  }
  await tf.ready();
};

export const preloadFacePresenceModel = () => {
  if (!modelPromise) {
    modelPromise = (async () => {
      await initBackend();
      return blazeface.load({ maxFaces: 3 });
    })().catch((error) => {
      modelPromise = null;
      console.error('Face detection model failed to load', error);
      throw error;
    });
  }
  return modelPromise;
};

const faceBoxMetrics = (face, videoWidth, videoHeight) => {
  const [x0, y0] = face.topLeft;
  const [x1, y1] = face.bottomRight;
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const centerX = x0 + width / 2;
  const centerY = y0 + height / 2;

  return {
    width,
    height,
    centerX,
    centerY,
    widthRatio: width / videoWidth,
    heightRatio: height / videoHeight,
    areaRatio: (width * height) / (videoWidth * videoHeight),
    probability: face.probability?.[0] ?? 0,
  };
};

const isValidFace = (face, videoWidth, videoHeight) => {
  const metrics = faceBoxMetrics(face, videoWidth, videoHeight);
  if (metrics.probability < 0.72) return false;
  if (metrics.widthRatio < 0.05 || metrics.heightRatio < 0.05) return false;
  if (metrics.widthRatio > 0.9 || metrics.heightRatio > 0.9) return false;
  if (metrics.areaRatio < 0.008) return false;

  const aspect = metrics.width / Math.max(metrics.height, 1);
  if (aspect < 0.45 || aspect > 1.65) return false;

  const marginX = videoWidth * 0.04;
  const marginY = videoHeight * 0.03;
  if (metrics.centerX < marginX || metrics.centerX > videoWidth - marginX) return false;
  if (metrics.centerY < marginY || metrics.centerY > videoHeight - marginY) return false;

  return true;
};

/**
 * Detect a single centered face in a live video feed using BlazeFace.
 */
export const detectPersonPresence = async (video) => {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return { detected: false, method: 'camera', reason: 'Camera feed is not ready.' };
  }

  try {
    const model = await preloadFacePresenceModel();
    const faces = await model.estimateFaces(video, false);
    const validFaces = faces.filter((face) =>
      isValidFace(face, video.videoWidth, video.videoHeight),
    );

    if (validFaces.length > 1) {
      return {
        detected: false,
        issueType: 'multiple_faces',
        method: 'ml',
        reason: 'Multiple faces detected. Please make sure you are the only person in frame.',
      };
    }

    if (validFaces.length === 1) {
      const confidence = faceBoxMetrics(validFaces[0], video.videoWidth, video.videoHeight).probability;
      return { detected: true, method: 'ml', confidence };
    }

    return {
      detected: false,
      issueType: 'no_face',
      method: 'ml',
      reason: 'No face detected in camera view.',
    };
  } catch {
    return {
      detected: false,
      issueType: 'no_face',
      method: 'ml',
      reason: 'Face detection is loading. Please wait a moment.',
    };
  }
};

/** Smooth UI state — fast to confirm, slower to drop (prevents flicker). */
export const createPersonPresenceStabilizer = () => {
  let positiveStreak = 0;
  let negativeStreak = 0;
  let stable = false;

  return {
    reset() {
      positiveStreak = 0;
      negativeStreak = 0;
      stable = false;
    },
    update(result) {
      const hit = Boolean(result?.detected);
      const confidence = Number(result?.confidence) || 0;
      const strongHit = hit && (result?.method === 'ml' && confidence >= 0.88);

      if (hit) {
        positiveStreak += strongHit ? 2 : 1;
        negativeStreak = 0;
      } else {
        negativeStreak += 1;
        positiveStreak = 0;
      }

      if (!stable) {
        if (strongHit || positiveStreak >= 2) {
          stable = true;
          positiveStreak = 0;
          negativeStreak = 0;
        }
      } else if (negativeStreak >= 4) {
        stable = false;
        positiveStreak = 0;
        negativeStreak = 0;
      }

      let message;
      if (stable) {
        message = 'Person detected';
      } else if (positiveStreak > 0) {
        message = 'Verifying face…';
      } else if (result?.reason?.includes('loading')) {
        message = result.reason;
      } else {
        message = result?.reason || 'No face detected in camera view.';
      }

      return { stable, message };
    },
  };
};
