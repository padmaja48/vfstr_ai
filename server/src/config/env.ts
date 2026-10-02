import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const placeholderToUndefined = (value: unknown) => {
  const normalized = emptyToUndefined(value);
  if (typeof normalized !== 'string') return normalized;

  const lower = normalized.toLowerCase();
  if (
    lower.startsWith('your-') ||
    lower.includes('_your-') ||
    lower.includes('xxxxxxxx') ||
    lower.includes('smtp.example') ||
    lower.includes('replace-with')
  ) {
    return undefined;
  }

  return normalized;
};

const optionalString = z.preprocess(placeholderToUndefined, z.string().optional());
const defaultedString = (fallback: string) => z.preprocess(emptyToUndefined, z.string().default(fallback));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: defaultedString('http://localhost:5173'),
  CORS_ORIGINS: defaultedString('http://localhost:5173').transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),
  VITE_API_URL: defaultedString('http://localhost:4000'),
  MONGODB_URI: defaultedString('mongodb://localhost:27017/fluentai'),
  JWT_SECRET: defaultedString('dev-jwt-secret-change-me-at-least-32-characters'),
  JWT_ACCESS_SECRET: optionalString,
  JWT_REFRESH_SECRET: optionalString,
  JWT_ACCESS_EXPIRES_IN: defaultedString('15m'),
  JWT_REFRESH_EXPIRES_IN: defaultedString('7d'),
  REFRESH_COOKIE_NAME: defaultedString('fluentai_refresh'),
  COOKIE_SECRET: defaultedString('dev-cookie-secret-change-me-at-least-32-characters'),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_CALLBACK_URL: defaultedString('http://localhost:4000/api/v1/auth/google/callback'),
  REDIS_URL: defaultedString('redis://localhost:6379'),
  BULLMQ_PREFIX: defaultedString('fluentai'),
  RESEND_API_KEY: optionalString,
  SMTP_URL: optionalString,
  EMAIL_FROM: defaultedString('FluentAI <noreply@fluentai.example>'),
  AI_PROVIDER: z.enum(['openai', 'groq']).default('openai'),
  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: defaultedString('https://api.openai.com/v1'),
  OPENAI_MODEL: defaultedString('gpt-4o-mini'),
  WHISPER_MODEL: defaultedString('gpt-4o-mini-transcribe'),
  GROQ_API_KEY: optionalString,
  GROQ_BASE_URL: defaultedString('https://api.groq.com/openai/v1'),
  GROQ_MODEL: defaultedString('openai/gpt-oss-120b'),
  GROQ_WHISPER_MODEL: defaultedString('whisper-large-v3-turbo'),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_VOICE_ID: defaultedString('your-default-voice-id'),
  ELEVENLABS_MODEL_ID: defaultedString('eleven_multilingual_v2'),
  ELEVENLABS_OUTPUT_FORMAT: defaultedString('mp3_44100_128'),
  ELEVENLABS_LANGUAGE_CODE: optionalString,
  ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID: optionalString,
  ELEVENLABS_PROFESSIONAL_MALE_VOICE_ID: optionalString,
  ELEVENLABS_NEUTRAL_VOICE_ID: optionalString,
  SARVAM_API_KEY: optionalString,
  SARVAM_TTS_MODEL: defaultedString('bulbul:v3'),
  SARVAM_TTS_LANGUAGE_CODE: defaultedString('en-IN'),
  SARVAM_TTS_ENDPOINT: defaultedString('https://api.sarvam.ai/text-to-speech'),
  SARVAM_STT_ENDPOINT: defaultedString('https://api.sarvam.ai/speech-to-text'),
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
  // Optional Google-quality search via Serper (serper.dev). Falls back to DuckDuckGo HTML if unset.
  SERPER_API_KEY: optionalString,
  VERCEL_PROJECT_ID: optionalString,
  RAILWAY_SERVICE_ID: optionalString,
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  JWT_ACCESS_SECRET: parsedEnv.JWT_ACCESS_SECRET ?? parsedEnv.JWT_SECRET,
  JWT_REFRESH_SECRET: parsedEnv.JWT_REFRESH_SECRET ?? parsedEnv.JWT_SECRET,
  CORS_ORIGINS: Array.from(new Set([parsedEnv.CLIENT_URL, ...parsedEnv.CORS_ORIGINS])),
};

if (env.NODE_ENV === 'production') {
  const weakSecrets = [
    env.JWT_ACCESS_SECRET.length < 32 || env.JWT_ACCESS_SECRET.startsWith('replace-with'),
    env.JWT_REFRESH_SECRET.length < 32 || env.JWT_REFRESH_SECRET.startsWith('replace-with'),
    env.COOKIE_SECRET.length < 32 || env.COOKIE_SECRET.startsWith('replace-with'),
  ];

  if (weakSecrets.some(Boolean)) {
    throw new Error('Production JWT and cookie secrets must be configured with strong values.');
  }
}
