const AUDIO_RECORDING_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

export const getSupportedAudioMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return AUDIO_RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

export const createAudioRecorder = (stream) => {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is not supported in this browser.');
  }

  const mimeType = getSupportedAudioMimeType();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 128000,
  });

  return { recorder, mimeType };
};

export const getAudioFileExtension = (mimeType = '') => {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes('mp4')) return 'm4a';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  return 'webm';
};

export const getRecordedAudioFileName = (baseName, mimeType) =>
  `${baseName}.${getAudioFileExtension(mimeType)}`;
