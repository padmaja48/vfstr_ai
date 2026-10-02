import { ttsAPI } from '../services/api';

export const TTS_SPEAKERS = [
  { id: 'priya', label: 'Priya', description: 'Female' },
  { id: 'rahul', label: 'Rahul', description: 'Male' },
];

export const TTS_SPEAKER_STORAGE_KEY = 'lsrw_tts_speaker';
export const TTS_VOICE_SETTINGS_STORAGE_KEY = 'lsrw_tts_voice_settings';

export const TTS_VOICE_STYLES = [
  { id: 'default', label: 'Persona Default' },
  { id: 'professional_female', label: 'Professional Female' },
  { id: 'professional_male', label: 'Professional Male' },
  { id: 'neutral', label: 'Neutral' },
];

export const DEFAULT_TTS_VOICE_SETTINGS = {
  volume: 1.35,
  speechRate: 1,
  pitch: 0,
  voiceStyle: 'default',
};

const TARGET_SPEECH_RMS = 0.155;
const QUIET_RMS_THRESHOLD = 0.09;
const PEAK_LIMIT = 0.98;
const MAX_NORMALIZE_GAIN = 2.8;
const MIN_DEFAULT_MAKEUP_GAIN = 1.25;
const SILENCE_THRESHOLD = 0.0025;
const SILENCE_HOLD_SECONDS = 0.04;

const audioBlobCache = new Map();
let sharedAudioContext;

export const normalizeTtsSpeaker = (speaker) => {
  if (speaker === 'rahul' || speaker === 'arjun') return 'rahul';
  return 'priya';
};

export const getStoredTtsSpeaker = () => {
  if (typeof window === 'undefined') return 'priya';
  return normalizeTtsSpeaker(window.localStorage.getItem(TTS_SPEAKER_STORAGE_KEY));
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const numberSetting = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeVoiceSettings = (settings = {}) => ({
  volume: clamp(numberSetting(settings.volume, DEFAULT_TTS_VOICE_SETTINGS.volume), 0, 2),
  speechRate: clamp(numberSetting(settings.speechRate, DEFAULT_TTS_VOICE_SETTINGS.speechRate), 0.75, 1.35),
  pitch: clamp(numberSetting(settings.pitch, DEFAULT_TTS_VOICE_SETTINGS.pitch), -6, 6),
  voiceStyle: TTS_VOICE_STYLES.some((style) => style.id === settings.voiceStyle)
    ? settings.voiceStyle
    : DEFAULT_TTS_VOICE_SETTINGS.voiceStyle,
});

export const getStoredTtsVoiceSettings = () => {
  if (typeof window === 'undefined') return DEFAULT_TTS_VOICE_SETTINGS;
  try {
    return normalizeVoiceSettings(JSON.parse(window.localStorage.getItem(TTS_VOICE_SETTINGS_STORAGE_KEY) || '{}'));
  } catch {
    return DEFAULT_TTS_VOICE_SETTINGS;
  }
};

export const storeTtsVoiceSettings = (settings) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TTS_VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeVoiceSettings(settings)));
};

export const voiceStyleToSpeaker = (voiceStyle = 'default') => {
  if (voiceStyle === 'professional_male') return 'rahul';
  return 'priya';
};

export const storeTtsSpeaker = (speaker) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TTS_SPEAKER_STORAGE_KEY, normalizeTtsSpeaker(speaker));
};

export const getApiErrorPayload = async (error) => {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    const text = await data.text().catch(() => '');
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return {
        code: parsed.code,
        message: parsed.error || parsed.message,
      };
    } catch {
      return { message: text };
    }
  }

  return {
    code: data?.code,
    message: data?.error || data?.message || error?.message,
  };
};

export const getApiErrorMessage = async (error, fallback = 'Unable to generate audio.') => {
  const payload = await getApiErrorPayload(error);
  return payload.message || fallback;
};

export const getTtsApiErrorMessage = async (error, fallback = 'Unable to generate audio.') => {
  const { code, message = '' } = await getApiErrorPayload(error);

  if (code === 'ELEVENLABS_NOT_CONFIGURED' || message.includes('ELEVENLABS_API_KEY')) {
    return 'ElevenLabs API key is missing in the server environment. Add ELEVENLABS_API_KEY and restart the server.';
  }

  if (code === 'ELEVENLABS_VOICE_NOT_CONFIGURED' || message.includes('ELEVENLABS_VOICE_ID is not configured')) {
    return 'ElevenLabs voice ID is missing in the server environment. Add ELEVENLABS_VOICE_ID and restart the server.';
  }

  if (code === 'ELEVENLABS_VOICE_REQUIRES_PAID_PLAN' || /paid plan|payment required|subscription/i.test(message)) {
    return 'Selected ElevenLabs voice requires a paid plan. Set the server ElevenLabs voice IDs to voices available to your API account, then restart the server.';
  }

  if (code === 'ELEVENLABS_QUOTA_EXCEEDED' || /quota|credits remaining|exceeds your quota/i.test(message)) {
    return 'ElevenLabs voice credits are used up for this clip. Upgrade your ElevenLabs plan or wait for your monthly credits to reset.';
  }

  return message || fallback;
};

const hashInput = async (text, speaker, options = {}) => {
  const normalizedOptions = normalizeTtsRequestOptions(options);
  const input = JSON.stringify({
    text,
    speaker,
    context: normalizedOptions.context || 'listening',
    level: normalizedOptions.level || '',
    pace: normalizedOptions.pace || '',
  });
  if (window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(i) || 0;
  }
  return String(hash);
};

const normalizeTtsRequestOptions = (options = {}) => {
  const requestOptions = {
    level: options.level,
    context: options.context || 'listening',
  };

  if (requestOptions.context !== 'listening' && typeof options.pace === 'number') {
    requestOptions.pace = options.pace;
  }

  return requestOptions;
};

export const getTtsAudioBlob = async (text, speaker = 'priya', options = {}) => {
  const cleanText = String(text || '').trim();
  const selectedSpeaker = normalizeTtsSpeaker(speaker);
  const requestOptions = normalizeTtsRequestOptions(options);
  const cacheKey = await hashInput(cleanText, selectedSpeaker, requestOptions);
  const cached = audioBlobCache.get(cacheKey);
  if (cached) return cached;

  const response = await ttsAPI.synthesize(cleanText, selectedSpeaker, requestOptions);
  const blob = response.data;
  audioBlobCache.set(cacheKey, blob);
  return blob;
};

export const stopTtsAudio = (audio) => {
  if (!audio) return;
  try {
    if (typeof audio.pause === 'function') audio.pause();
    else if (typeof audio.stop === 'function') audio.stop();
  } catch {
    // The element may already be detached.
  }
  if (audio._ttsCleanup) audio._ttsCleanup();
};

const getAudioContext = () => {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioCtor();
  }
  return sharedAudioContext;
};

const db = (value) => 20 * Math.log10(Math.max(value, 0.000001));

const analyzeBufferRange = (buffer, startFrame = 0, endFrame = buffer.length) => {
  let sumSquares = 0;
  let peak = 0;
  let samples = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = startFrame; i < endFrame; i += 1) {
      const abs = Math.abs(data[i]);
      peak = Math.max(peak, abs);
      sumSquares += data[i] * data[i];
      samples += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples));
  return {
    rms,
    peak,
    rmsDb: Number(db(rms).toFixed(1)),
    peakDb: Number(db(peak).toFixed(1)),
    lufsApprox: Number((db(rms) - 0.7).toFixed(1)),
  };
};

const findTrimFrames = (buffer) => {
  const holdFrames = Math.max(1, Math.round(buffer.sampleRate * SILENCE_HOLD_SECONDS));
  const isAudibleFrame = (frame) => {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      if (Math.abs(buffer.getChannelData(channel)[frame]) > SILENCE_THRESHOLD) return true;
    }
    return false;
  };

  let start = 0;
  while (start < buffer.length && !isAudibleFrame(start)) start += 1;
  start = Math.max(0, start - holdFrames);

  let end = buffer.length - 1;
  while (end > start && !isAudibleFrame(end)) end -= 1;
  end = Math.min(buffer.length, end + holdFrames);

  return { start, end: Math.max(start + 1, end) };
};

const copyNormalizedBuffer = (audioContext, sourceBuffer, startFrame, endFrame, gain) => {
  const frameCount = Math.max(1, endFrame - startFrame);
  const output = audioContext.createBuffer(
    sourceBuffer.numberOfChannels,
    frameCount,
    sourceBuffer.sampleRate,
  );

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
    const input = sourceBuffer.getChannelData(channel);
    const outputData = output.getChannelData(channel);
    for (let i = 0; i < frameCount; i += 1) {
      outputData[i] = clamp(input[startFrame + i] * gain, -PEAK_LIMIT, PEAK_LIMIT);
    }
  }

  return output;
};

const playHtmlAudioBlob = async (blob, { onPlay, onEnded, onError } = {}) => {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = 1;
  let cleaned = false;

  audio._ttsCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    URL.revokeObjectURL(url);
  };
  audio.onplay = () => onPlay?.(audio);
  audio.onended = () => {
    audio._ttsCleanup();
    onEnded?.();
  };
  audio.onerror = () => {
    audio._ttsCleanup();
    onError?.();
  };
  await audio.play();
  return audio;
};

export const playProcessedTtsBlob = async (
  blob,
  {
    settings,
    onPlay,
    onEnded,
    onError,
    onDiagnostics,
    diagnosticsLabel = 'tts',
  } = {},
) => {
  const voiceSettings = normalizeVoiceSettings(settings ?? getStoredTtsVoiceSettings());
  const audioContext = getAudioContext();
  if (!audioContext) {
    return playHtmlAudioBlob(blob, { onPlay, onEnded, onError });
  }

  try {
    if (audioContext.state === 'suspended') await audioContext.resume();
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const { start, end } = findTrimFrames(decoded);
    const original = analyzeBufferRange(decoded);
    const trimmed = analyzeBufferRange(decoded, start, end);
    const targetGain = TARGET_SPEECH_RMS / Math.max(trimmed.rms, 0.000001);
    const peakSafeGain = PEAK_LIMIT / Math.max(trimmed.peak, 0.000001);
    const normalizeGain = clamp(
      Math.min(Math.max(targetGain, MIN_DEFAULT_MAKEUP_GAIN), peakSafeGain),
      0.65,
      MAX_NORMALIZE_GAIN,
    );
    const processedBuffer = copyNormalizedBuffer(audioContext, decoded, start, end, normalizeGain);
    const processed = analyzeBufferRange(processedBuffer);
    const source = audioContext.createBufferSource();
    const highpass = audioContext.createBiquadFilter();
    const presence = audioContext.createBiquadFilter();
    const compressor = audioContext.createDynamicsCompressor();
    const outputGain = audioContext.createGain();
    const pitchRate = 2 ** (voiceSettings.pitch / 12);

    source.buffer = processedBuffer;
    source.playbackRate.value = clamp(voiceSettings.speechRate * pitchRate, 0.55, 1.7);
    highpass.type = 'highpass';
    highpass.frequency.value = 90;
    highpass.Q.value = 0.7;
    presence.type = 'peaking';
    presence.frequency.value = 3200;
    presence.Q.value = 0.9;
    presence.gain.value = 3.5;
    compressor.threshold.value = -8;
    compressor.knee.value = 8;
    compressor.ratio.value = 10;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    outputGain.gain.value = voiceSettings.volume;

    source.connect(highpass);
    highpass.connect(presence);
    presence.connect(outputGain);
    outputGain.connect(compressor);
    compressor.connect(audioContext.destination);

    let stopped = false;
    let cleanupDone = false;
    const diagnostics = {
      label: diagnosticsLabel,
      original,
      trimmed,
      processed,
      targetLufs: -16,
      normalizeGain: Number(normalizeGain.toFixed(2)),
      playbackGain: Number(voiceSettings.volume.toFixed(2)),
      speechRate: Number(voiceSettings.speechRate.toFixed(2)),
      pitch: voiceSettings.pitch,
      trimmedStartMs: Number(((start / decoded.sampleRate) * 1000).toFixed(0)),
      trimmedEndMs: Number((((decoded.length - end) / decoded.sampleRate) * 1000).toFixed(0)),
      quietAudioDetected: trimmed.rms < QUIET_RMS_THRESHOLD,
      userAgent: window.navigator.userAgent,
      audioContextState: audioContext.state,
      sampleRate: audioContext.sampleRate,
    };
    const controller = {
      get paused() { return stopped; },
      _ttsDiagnostics: diagnostics,
      _ttsCleanup: () => {
        if (cleanupDone) return;
        cleanupDone = true;
        try { source.disconnect(); } catch {}
        try { highpass.disconnect(); } catch {}
        try { presence.disconnect(); } catch {}
        try { outputGain.disconnect(); } catch {}
        try { compressor.disconnect(); } catch {}
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        try { source.stop(); } catch {}
        controller._ttsCleanup();
      },
      pause: () => controller.stop(),
    };

    source.onended = () => {
      if (stopped) return;
      stopped = true;
      controller._ttsCleanup();
      onEnded?.();
    };

    console.info('[TTS diagnostics]', diagnostics);
    onDiagnostics?.(diagnostics);
    source.start(0);
    onPlay?.(controller);
    return controller;
  } catch {
    return playHtmlAudioBlob(blob, { onPlay, onEnded, onError });
  }
};

export const playTtsAudio = async ({
  text,
  speaker = 'priya',
  level,
  context = 'listening',
  onPlay,
  onEnded,
  onError,
  settings,
  onDiagnostics,
}) => {
  const voiceSettings = normalizeVoiceSettings(
    settings ?? (context === 'listening' ? DEFAULT_TTS_VOICE_SETTINGS : getStoredTtsVoiceSettings()),
  );
  const blob = await getTtsAudioBlob(text, speaker, { level, context });
  return playProcessedTtsBlob(blob, {
    settings: voiceSettings,
    onPlay,
    onEnded,
    onError,
    onDiagnostics,
    diagnosticsLabel: context,
  });
};
