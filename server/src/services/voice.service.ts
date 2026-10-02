import * as crypto from 'crypto';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export type VoiceStyle = 'default' | 'professional_female' | 'professional_male' | 'neutral';
export type TtsSpeaker = 'priya' | 'rahul';
export type TtsSpeakerInput = TtsSpeaker | 'meera' | 'arjun';
export type TtsContext = 'listening' | 'speaking' | 'interview' | 'preview';

type SynthesizeSpeechOptions = {
  context?: TtsContext;
  level?: string;
  pace?: number;
  sentenceGapMs?: number;
  voiceId?: string;
};

type CachedSpeech = {
  buffer: Buffer;
  contentType: string;
  cacheKey: string;
};

const speechCache = new Map<string, CachedSpeech>();
const MAX_CACHE_ITEMS = 250;
const SARVAM_OUTPUT_CODEC = 'wav';
const SARVAM_SAMPLE_RATE = 24000;

const SARVAM_PERSONA_SPEAKERS: Record<string, string> = {
  'us-indian': 'priya',
  'us-australian': 'ishita',
  'ru-russian': 'ratan',
};

const ELEVENLABS_PREMADE_VOICE_IDS: Record<VoiceStyle, string> = {
  default: 'XrExE9yKIg1WjnnlVkGX',
  professional_female: 'XrExE9yKIg1WjnnlVkGX',
  professional_male: 'JBFqnCBsd6RMkjVDRZzb',
  neutral: 'XrExE9yKIg1WjnnlVkGX',
};

export const ELEVENLABS_LISTENING_NARRATOR_VOICE_ID = ELEVENLABS_PREMADE_VOICE_IDS.neutral;

/* ── Per-persona voice style mapping ───────────────── */
export const getPersonaVoiceStyle = (personaId: string): VoiceStyle => {
  const map: Record<string, VoiceStyle> = {
    'us-american': 'professional_male',
    'us-indian': 'professional_female',
    'us-australian': 'neutral',
    'ru-russian': 'professional_male',
  };
  return map[personaId] ?? 'default';
};

/* ── Per-persona intro phrases for voice preview / live open ───── */
export const getPersonaIntro = (personaId: string): string => {
  const intros: Record<string, string> = {
    'us-indian':
      "Hi, I'm Priya Sharma. I'm looking forward to our technical discussion today. Let's start with a quick introduction.",
    'us-australian':
      "Hi, I'm Ananya Rao. Let's keep this focused and conversational. I'll start with a short intro from you.",
    'ru-russian':
      'Hello, I am Rahul Menon. I will focus on clear technical reasoning. Please begin with a brief introduction.',
  };
  return intros[personaId] ?? "Hello. I will be your interviewer today. Let's begin with a short introduction.";
};

export const getPersonaClosing = (personaId: string): string => {
  const closings: Record<string, string> = {
    'us-indian':
      'Thanks for walking me through your experience. Keep sharpening one concrete project story with metrics. Good luck with your interviews.',
    'us-australian':
      "Appreciate your time today. One growth area: tighter, outcome-led answers. Thanks again — you're done.",
    'ru-russian':
      'That concludes our session. Keep improving depth on trade-offs. Thank you.',
  };
  return closings[personaId] ?? 'Thank you for the interview. Review your report for strengths and one area to practice next.';
};

export const normalizeTtsSpeaker = (speaker?: string): TtsSpeaker =>
  speaker === 'rahul' || speaker === 'arjun' ? 'rahul' : 'priya';

const speakerFromVoiceStyle = (voiceStyle: VoiceStyle = 'default'): TtsSpeaker => {
  if (voiceStyle === 'professional_male') return 'rahul';
  return 'priya';
};

export const getListeningPaceForLevel = (level?: string): number => {
  if (level === 'A1' || level === 'A2') return 0.85;
  if (level === 'B1' || level === 'B2') return 0.95;
  return 1.0;
};

export const splitTextIntoSentences = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);
  return (matches ?? [normalized]).map((sentence) => sentence.trim()).filter(Boolean);
};

const resolvePace = (options: SynthesizeSpeechOptions) => {
  if (typeof options.pace === 'number') return options.pace;
  if (options.context === 'listening') return getListeningPaceForLevel(options.level);
  return 1.0;
};

const clampElevenLabsSpeed = (pace: number) => Math.max(0.7, Math.min(1.2, Number(pace.toFixed(2))));

const configuredValue = (value?: string) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith('your-')) return undefined;
  return trimmed;
};

const resolveVoiceId = (speaker: TtsSpeaker, voiceStyle: VoiceStyle, context: TtsContext) => {
  const defaultVoiceId = configuredValue(env.ELEVENLABS_VOICE_ID);
  if (voiceStyle === 'neutral') {
    return configuredValue(env.ELEVENLABS_NEUTRAL_VOICE_ID)
      ?? (context === 'interview' ? ELEVENLABS_PREMADE_VOICE_IDS.neutral : defaultVoiceId);
  }

  if (speaker === 'rahul') {
    return configuredValue(env.ELEVENLABS_PROFESSIONAL_MALE_VOICE_ID)
      ?? (context === 'interview' ? ELEVENLABS_PREMADE_VOICE_IDS.professional_male : defaultVoiceId);
  }

  return configuredValue(env.ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID)
    ?? (context === 'interview' ? ELEVENLABS_PREMADE_VOICE_IDS.professional_female : defaultVoiceId);
};

const fallbackVoiceIdFor = (speaker: TtsSpeaker, voiceStyle: VoiceStyle) => {
  if (voiceStyle === 'neutral') return ELEVENLABS_PREMADE_VOICE_IDS.neutral;
  if (voiceStyle === 'professional_male' || speaker === 'rahul') {
    return ELEVENLABS_PREMADE_VOICE_IDS.professional_male;
  }
  return ELEVENLABS_PREMADE_VOICE_IDS.professional_female;
};

const voiceCandidatesFor = (voiceId: string | undefined, speaker: TtsSpeaker, voiceStyle: VoiceStyle, context: TtsContext) =>
  Array.from(
    new Set(
      (context === 'interview'
        ? [voiceId]
        : [
            voiceId,
            configuredValue(env.ELEVENLABS_VOICE_ID),
            fallbackVoiceIdFor(speaker, voiceStyle),
            ELEVENLABS_PREMADE_VOICE_IDS.default,
          ]
      ).filter(Boolean) as string[],
    ),
  );

const contentTypeForOutputFormat = (outputFormat: string) => {
  if (outputFormat.startsWith('wav_')) return 'audio/wav';
  if (outputFormat.startsWith('pcm_')) return 'audio/L16';
  if (outputFormat.startsWith('ulaw_')) return 'audio/basic';
  return 'audio/mpeg';
};

const contentTypeForSarvamCodec = (codec: string) => {
  if (codec === 'mp3') return 'audio/mpeg';
  if (codec === 'opus') return 'audio/ogg';
  if (codec === 'flac') return 'audio/flac';
  if (codec === 'aac') return 'audio/aac';
  if (codec === 'linear16') return 'audio/L16';
  if (codec === 'mulaw' || codec === 'alaw') return 'audio/basic';
  return 'audio/wav';
};

type ProviderErrorDetails = {
  status?: string;
  code?: string;
  message?: string;
};

const parseProviderError = (errorText: string): ProviderErrorDetails => {
  if (!errorText) return {};

  try {
    const payload = JSON.parse(errorText) as {
      detail?: string | { status?: string; message?: string; code?: string };
      message?: string;
      error?: string;
    };
    const detail = typeof payload.detail === 'object' ? payload.detail : undefined;
    return {
      status: detail?.status,
      code: detail?.code,
      message: detail?.message ?? (typeof payload.detail === 'string' ? payload.detail : undefined) ?? payload.message ?? payload.error,
    };
  } catch {
    return { message: errorText };
  }
};

const isElevenLabsQuotaError = (responseStatus: number, errorText: string) =>
  (responseStatus === 401 || responseStatus === 429) &&
  /quota|credits remaining|exceeds your/i.test(errorText);

const elevenLabsAppError = (responseStatus: number, errorText: string) => {
  const providerError = parseProviderError(errorText);
  const providerStatus = providerError.status?.toLowerCase();
  const providerCode = providerError.code?.toLowerCase();
  const isPaidPlanRequired =
    responseStatus === 402 ||
    providerStatus === 'payment_required' ||
    providerCode === 'paid_plan_required' ||
    /paid plan|payment required|subscription/i.test(providerError.message ?? '');

  if (isPaidPlanRequired) {
    return new AppError(
      'Selected ElevenLabs voice requires a paid plan. Use a voice available to your ElevenLabs API account.',
      402,
      'ELEVENLABS_VOICE_REQUIRES_PAID_PLAN',
    );
  }

  if (isElevenLabsQuotaError(responseStatus, errorText)) {
    return new AppError(
      'ElevenLabs TTS quota exceeded for this clip. Upgrade your ElevenLabs plan or wait for your monthly credits to reset.',
      429,
      'ELEVENLABS_QUOTA_EXCEEDED',
    );
  }

  const providerMessage = providerError.message ? `: ${providerError.message}` : '';
  return new AppError(
    `ElevenLabs TTS failed with status ${responseStatus}${providerMessage}`,
    502,
    'ELEVENLABS_TTS_FAILED',
  );
};

const isElevenLabsPaidPlanError = (error: unknown) =>
  error instanceof AppError && error.code === 'ELEVENLABS_VOICE_REQUIRES_PAID_PLAN';

const isElevenLabsQuotaAppError = (error: unknown) =>
  error instanceof AppError && error.code === 'ELEVENLABS_QUOTA_EXCEEDED';

const sarvamSpeakerForListening = (speaker: TtsSpeaker) => (speaker === 'rahul' ? 'rahul' : 'priya');

const synthesizeListeningWithSarvam = async (
  normalizedText: string,
  selectedSpeaker: TtsSpeaker,
  context: TtsContext,
  pace: number,
): Promise<CachedSpeech> => {
  const sarvamSpeaker = sarvamSpeakerForListening(selectedSpeaker);
  const cacheKey = cacheKeyForSarvam(normalizedText, sarvamSpeaker, { context, pace });
  const cached = speechCache.get(cacheKey);
  if (cached) return cached;

  const audio = await callSarvam(normalizedText, sarvamSpeaker, pace);
  const item = { ...audio, cacheKey };
  remember(item);
  return item;
};

const cacheKeyFor = (
  text: string,
  speaker: TtsSpeaker,
  voiceId: string,
  options: Required<Pick<SynthesizeSpeechOptions, 'context'>> & { pace: number; outputFormat: string },
) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        text,
        speaker,
        voiceId,
        context: options.context,
        pace: options.pace,
        outputFormat: options.outputFormat,
        languageCode: env.ELEVENLABS_LANGUAGE_CODE,
        model: env.ELEVENLABS_MODEL_ID,
        provider: 'elevenlabs',
      }),
    )
    .digest('hex');

const cacheKeyForSarvam = (
  text: string,
  speaker: string,
  options: Required<Pick<SynthesizeSpeechOptions, 'context'>> & { pace: number },
) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        text,
        speaker,
        context: options.context,
        pace: options.pace,
        languageCode: env.SARVAM_TTS_LANGUAGE_CODE,
        model: env.SARVAM_TTS_MODEL,
        outputCodec: SARVAM_OUTPUT_CODEC,
        sampleRate: SARVAM_SAMPLE_RATE,
        provider: 'sarvam',
      }),
    )
    .digest('hex');

const remember = (item: CachedSpeech) => {
  if (speechCache.size >= MAX_CACHE_ITEMS) {
    const oldestKey = speechCache.keys().next().value;
    if (oldestKey) speechCache.delete(oldestKey);
  }
  speechCache.set(item.cacheKey, item);
};

const callElevenLabs = async (
  text: string,
  voiceId: string,
  pace: number,
): Promise<Omit<CachedSpeech, 'cacheKey'>> => {
  if (!env.ELEVENLABS_API_KEY) {
    throw new AppError('ELEVENLABS_API_KEY is not configured.', 503, 'ELEVENLABS_NOT_CONFIGURED');
  }

  const outputFormat = env.ELEVENLABS_OUTPUT_FORMAT;
  const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  endpoint.searchParams.set('output_format', outputFormat);

  const body: Record<string, unknown> = {
    text,
    model_id: env.ELEVENLABS_MODEL_ID,
    voice_settings: {
      stability: 0.55,
      similarity_boost: 0.8,
      style: 0,
      use_speaker_boost: true,
      speed: clampElevenLabsSpeed(pace),
    },
  };
  if (env.ELEVENLABS_LANGUAGE_CODE) body.language_code = env.ELEVENLABS_LANGUAGE_CODE;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'content-type': 'application/json',
      accept: 'audio/mpeg,audio/wav,audio/*,application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw elevenLabsAppError(response.status, errorText || response.statusText);
  }

  const contentType = response.headers.get('content-type') ?? contentTypeForOutputFormat(outputFormat);
  const arrayBuffer = await response.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: contentType.includes('audio/') ? contentType : contentTypeForOutputFormat(outputFormat),
  };
};

const getCachedElevenLabsSpeech = async (
  normalizedText: string,
  selectedSpeaker: TtsSpeaker,
  voiceId: string,
  context: TtsContext,
  pace: number,
) => {
  const outputFormat = env.ELEVENLABS_OUTPUT_FORMAT;
  const cacheKey = cacheKeyFor(normalizedText, selectedSpeaker, voiceId, {
    context,
    pace,
    outputFormat,
  });
  const cached = speechCache.get(cacheKey);
  if (cached) return cached;

  const audio = await callElevenLabs(normalizedText, voiceId, pace);
  const item = {
    ...audio,
    cacheKey,
  };
  remember(item);
  return item;
};

const callSarvam = async (
  text: string,
  speaker: string,
  pace: number,
): Promise<Omit<CachedSpeech, 'cacheKey'>> => {
  if (!env.SARVAM_API_KEY) {
    throw new AppError('SARVAM_API_KEY is not configured.', 503, 'SARVAM_NOT_CONFIGURED');
  }

  const response = await fetch(env.SARVAM_TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-subscription-key': env.SARVAM_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      text,
      target_language_code: env.SARVAM_TTS_LANGUAGE_CODE,
      model: env.SARVAM_TTS_MODEL,
      speaker,
      pace: Math.max(0.5, Math.min(2, Number(pace.toFixed(2)))),
      speech_sample_rate: SARVAM_SAMPLE_RATE,
      output_audio_codec: SARVAM_OUTPUT_CODEC,
      temperature: 0.55,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new AppError(
      `Sarvam TTS ${response.status}: ${errorText || response.statusText}`,
      502,
      'SARVAM_TTS_FAILED',
    );
  }

  const payload = (await response.json()) as { audios?: string[] };
  const audioBase64 = payload.audios?.[0];
  if (!audioBase64) {
    throw new AppError('Sarvam TTS returned no audio.', 502, 'SARVAM_TTS_EMPTY_AUDIO');
  }

  return {
    buffer: Buffer.from(audioBase64, 'base64'),
    contentType: contentTypeForSarvamCodec(SARVAM_OUTPUT_CODEC),
  };
};

export const synthesizeSpeech = async (
  text: string,
  voiceStyle: VoiceStyle = 'default',
  personaId?: string,
  speaker?: TtsSpeakerInput | string,
  options: SynthesizeSpeechOptions = {},
): Promise<CachedSpeech> => {
  const resolvedVoiceStyle = personaId ? getPersonaVoiceStyle(personaId) : voiceStyle;
  const selectedSpeaker = speaker
    ? normalizeTtsSpeaker(speaker)
    : speakerFromVoiceStyle(resolvedVoiceStyle);

  const normalizedText = text.trim();
  const context = options.context ?? 'interview';
  const pace = resolvePace({ ...options, context });
  const sarvamSpeaker = personaId ? SARVAM_PERSONA_SPEAKERS[personaId] : undefined;
  if (sarvamSpeaker && configuredValue(env.SARVAM_API_KEY)) {
    const cacheKey = cacheKeyForSarvam(normalizedText, sarvamSpeaker, {
      context,
      pace,
    });
    const cached = speechCache.get(cacheKey);
    if (cached) return cached;

    try {
      const audio = await callSarvam(normalizedText, sarvamSpeaker, pace);
      const item = {
        ...audio,
        cacheKey,
      };
      remember(item);
      return item;
    } catch (error) {
      if (!configuredValue(env.ELEVENLABS_API_KEY)) throw error;
    }
  }

  const voiceId = configuredValue(options.voiceId)
    ?? resolveVoiceId(selectedSpeaker, resolvedVoiceStyle, context);
  const voiceCandidates = voiceCandidatesFor(voiceId, selectedSpeaker, resolvedVoiceStyle, context);
  if (!voiceCandidates.length) {
    if (context === 'interview') {
      console.error('Interview TTS voice unavailable: no voice ID resolved for the selected persona.', {
        personaId,
        voiceStyle: resolvedVoiceStyle,
        speaker: selectedSpeaker,
      });
    }
    throw new AppError('ELEVENLABS_VOICE_ID is not configured.', 503, 'ELEVENLABS_VOICE_NOT_CONFIGURED');
  }

  let paidPlanError: unknown;
  let quotaError: unknown;
  for (const candidateVoiceId of voiceCandidates) {
    try {
      return await getCachedElevenLabsSpeech(normalizedText, selectedSpeaker, candidateVoiceId, context, pace);
    } catch (error) {
      if (isElevenLabsQuotaAppError(error)) {
        quotaError = error;
        break;
      }
      if (!isElevenLabsPaidPlanError(error)) {
        if (context === 'interview') {
          console.error('Interview TTS voice failed; no alternate voice will be used.', {
            personaId,
            voiceStyle: resolvedVoiceStyle,
            speaker: selectedSpeaker,
            voiceId: candidateVoiceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      paidPlanError = error;
    }
  }

  if (
    quotaError &&
    context === 'listening' &&
    configuredValue(env.SARVAM_API_KEY)
  ) {
    try {
      return await synthesizeListeningWithSarvam(normalizedText, selectedSpeaker, context, pace);
    } catch {
      throw quotaError;
    }
  }

  if (quotaError) {
    if (context === 'interview') {
      console.error('Interview TTS quota failed for the selected voice; no alternate voice will be used.', {
        personaId,
        voiceStyle: resolvedVoiceStyle,
        speaker: selectedSpeaker,
        voiceId,
      });
    }
    throw quotaError;
  }

  if (context === 'interview') {
    console.error('Interview TTS selected voice requires unavailable access; no alternate voice will be used.', {
      personaId,
      voiceStyle: resolvedVoiceStyle,
      speaker: selectedSpeaker,
      voiceId,
    });
  }
  throw paidPlanError;
};
