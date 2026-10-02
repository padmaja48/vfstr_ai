import { env } from '../config/env';
import { getListeningPaceForLevel, splitTextIntoSentences, synthesizeSpeech } from '../services/voice.service';

const makeMp3 = () => Buffer.from([0xff, 0xfb, 0x90, 0x64]);
const paidPlanBody = JSON.stringify({
  detail: {
    status: 'payment_required',
    message: 'Please upgrade your subscription to use this voice.',
    code: 'paid_plan_required',
    request_id: 'test-request',
  },
});

describe('ElevenLabs listening TTS pacing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prepares A1.0004-style listening clips sentence-by-sentence at the A1 pace', () => {
    const clipA10004 =
      'Anita: Hello Ravi. This is LC-A1-0004, a short food message at the service counter. I have the bus ticket and the important detail is the room number. Ravi: I understand. We need to call the front desk at minute 33.';

    expect(getListeningPaceForLevel('A1')).toBe(0.85);
    expect(splitTextIntoSentences(clipA10004)).toEqual([
      'Anita: Hello Ravi.',
      'This is LC-A1-0004, a short food message at the service counter.',
      'I have the bus ticket and the important detail is the room number.',
      'Ravi: I understand.',
      'We need to call the front desk at minute 33.',
    ]);
  });

  it('calls ElevenLabs with the A1 pace as voice speed', async () => {
    (env as typeof env & { ELEVENLABS_API_KEY: string }).ELEVENLABS_API_KEY = 'test-key';
    (env as typeof env & { ELEVENLABS_VOICE_ID: string }).ELEVENLABS_VOICE_ID = 'test-voice-id';
    (env as typeof env & { ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID: string }).ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID = 'test-voice-id';
    (env as typeof env & { ELEVENLABS_OUTPUT_FORMAT: string }).ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
    (env as typeof env & { ELEVENLABS_MODEL_ID: string }).ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(makeMp3(), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );
    const clipA10004 =
      'Anita: Hello Ravi. This is LC-A1-0004, a short food message at the service counter. I have the bus ticket and the important detail is the room number. Ravi: I understand. We need to call the front desk at minute 33.';

    const audio = await synthesizeSpeech(clipA10004, 'default', undefined, 'priya', {
      context: 'listening',
      level: 'A1',
      sentenceGapMs: 500,
    });
    const [url, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(init?.body));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(url)).toBe('https://api.elevenlabs.io/v1/text-to-speech/test-voice-id?output_format=mp3_44100_128');
    expect(init?.headers).toMatchObject({ 'xi-api-key': 'test-key' });
    expect(payload.text).toBe(clipA10004);
    expect(payload.model_id).toBe('eleven_multilingual_v2');
    expect(payload.voice_settings.speed).toBe(0.85);
    expect(audio.contentType).toBe('audio/mpeg');
    expect(audio.buffer).toEqual(makeMp3());
  });

  it('retries with the default ElevenLabs voice when a style voice requires a paid plan', async () => {
    (env as typeof env & { ELEVENLABS_API_KEY: string }).ELEVENLABS_API_KEY = 'test-key';
    (env as typeof env & { ELEVENLABS_VOICE_ID: string }).ELEVENLABS_VOICE_ID = 'default-voice-id';
    (env as typeof env & { ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID: string }).ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID = 'paid-female-voice-id';
    (env as typeof env & { ELEVENLABS_OUTPUT_FORMAT: string }).ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
    (env as typeof env & { ELEVENLABS_MODEL_ID: string }).ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(async () =>
        new Response(paidPlanBody, {
          status: 402,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockImplementationOnce(async () =>
        new Response(makeMp3(), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        }),
      );

    const audio = await synthesizeSpeech('This retry should use the default voice.', 'professional_female', undefined, undefined, {
      context: 'listening',
      level: 'B1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/paid-female-voice-id?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/default-voice-id?');
    expect(audio.contentType).toBe('audio/mpeg');
    expect(audio.buffer).toEqual(makeMp3());
  });

  it('retries with a premade ElevenLabs voice when the configured default voice requires a paid plan', async () => {
    (env as typeof env & { ELEVENLABS_API_KEY: string }).ELEVENLABS_API_KEY = 'test-key';
    (env as typeof env & { ELEVENLABS_VOICE_ID: string }).ELEVENLABS_VOICE_ID = 'paid-default-voice-id';
    (env as typeof env & { ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID: string | undefined }).ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID = undefined;
    (env as typeof env & { ELEVENLABS_OUTPUT_FORMAT: string }).ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(async () =>
        new Response(paidPlanBody, {
          status: 402,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockImplementationOnce(async () =>
        new Response(makeMp3(), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        }),
      );

    const audio = await synthesizeSpeech('This paid voice should use a premade fallback.', 'professional_female', undefined, undefined, {
      context: 'listening',
      level: 'B1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/paid-default-voice-id?');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/XrExE9yKIg1WjnnlVkGX?');
    expect(audio.contentType).toBe('audio/mpeg');
    expect(audio.buffer).toEqual(makeMp3());
  });

  it('uses Sarvam Indian English speakers for interview personas', async () => {
    (env as typeof env & { SARVAM_API_KEY: string }).SARVAM_API_KEY = 'test-sarvam-key';
    (env as typeof env & { SARVAM_TTS_ENDPOINT: string }).SARVAM_TTS_ENDPOINT = 'https://api.sarvam.ai/text-to-speech';
    (env as typeof env & { SARVAM_TTS_MODEL: string }).SARVAM_TTS_MODEL = 'bulbul:v3';
    (env as typeof env & { SARVAM_TTS_LANGUAGE_CODE: string }).SARVAM_TTS_LANGUAGE_CODE = 'en-IN';
    const wav = Buffer.from('RIFF');
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ audios: [wav.toString('base64')] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const audio = await synthesizeSpeech('Welcome to the interview.', 'neutral', 'us-australian', undefined, {
      context: 'preview',
      pace: 0.95,
    });
    const [url, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(init?.body));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(url)).toBe('https://api.sarvam.ai/text-to-speech');
    expect(init?.headers).toMatchObject({ 'api-subscription-key': 'test-sarvam-key' });
    expect(payload).toMatchObject({
      text: 'Welcome to the interview.',
      target_language_code: 'en-IN',
      model: 'bulbul:v3',
      speaker: 'ishita',
      output_audio_codec: 'wav',
      speech_sample_rate: 24000,
      pace: 0.95,
    });
    expect(audio.contentType).toBe('audio/wav');
    expect(audio.buffer).toEqual(wav);
  });

  it('falls back to Sarvam for listening clips when ElevenLabs quota is exceeded', async () => {
    (env as typeof env & { ELEVENLABS_API_KEY: string }).ELEVENLABS_API_KEY = 'test-key';
    (env as typeof env & { ELEVENLABS_VOICE_ID: string }).ELEVENLABS_VOICE_ID = 'test-voice-id';
    (env as typeof env & { ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID: string }).ELEVENLABS_PROFESSIONAL_FEMALE_VOICE_ID = 'test-voice-id';
    (env as typeof env & { ELEVENLABS_OUTPUT_FORMAT: string }).ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
    (env as typeof env & { ELEVENLABS_MODEL_ID: string }).ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
    (env as typeof env & { SARVAM_API_KEY: string }).SARVAM_API_KEY = 'test-sarvam-key';
    (env as typeof env & { SARVAM_TTS_ENDPOINT: string }).SARVAM_TTS_ENDPOINT = 'https://api.sarvam.ai/text-to-speech';
    (env as typeof env & { SARVAM_TTS_MODEL: string }).SARVAM_TTS_MODEL = 'bulbul:v3';
    (env as typeof env & { SARVAM_TTS_LANGUAGE_CODE: string }).SARVAM_TTS_LANGUAGE_CODE = 'en-IN';
    const wav = Buffer.from('RIFF');
    const quotaBody = JSON.stringify({
      detail: {
        status: 'quota_exceeded',
        message: 'This request exceeds your quota of 10000. You have 0 credits remaining, while 445 credits are required for this request.',
      },
    });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(async () =>
        new Response(quotaBody, {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ audios: [wav.toString('base64')] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const audio = await synthesizeSpeech('Short listening clip.', 'neutral', undefined, 'priya', {
      context: 'listening',
      level: 'A1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('elevenlabs.io');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.sarvam.ai/text-to-speech');
    expect(audio.contentType).toBe('audio/wav');
    expect(audio.buffer).toEqual(wav);
  });

  it('keeps higher levels closer to natural speed', () => {
    expect(getListeningPaceForLevel('A2')).toBe(0.85);
    expect(getListeningPaceForLevel('B1')).toBe(0.95);
    expect(getListeningPaceForLevel('B2')).toBe(0.95);
    expect(getListeningPaceForLevel('C1')).toBe(1.0);
    expect(getListeningPaceForLevel('C2')).toBe(1.0);
  });
});
