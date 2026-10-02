import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAccountSetupComplete, requireActiveAccount } from '../middleware/auth';
import { speakLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  ELEVENLABS_LISTENING_NARRATOR_VOICE_ID,
  normalizeTtsSpeaker,
  synthesizeSpeech,
  VoiceStyle,
} from '../services/voice.service';

const ttsSchema = z.object({
  body: z.object({
    text: z.string().min(1),
    speaker: z.enum(['priya', 'rahul', 'meera', 'arjun']).default('priya'),
    context: z.enum(['listening', 'speaking', 'interview', 'preview']).default('listening'),
    level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
    pace: z.coerce.number().min(0.75).max(1.35).optional(),
  }),
});

const router = Router();

router.use(authenticate);
router.use(requireActiveAccount);
router.use(requireAccountSetupComplete);

router.post(
  '/',
  speakLimiter,
  validate(ttsSchema),
  asyncHandler(async (req, res) => {
    const speaker = normalizeTtsSpeaker(req.body.speaker);
    const voiceStyle: VoiceStyle = req.body.context === 'listening' ? 'neutral' : 'default';
    const audio = await synthesizeSpeech(req.body.text, voiceStyle, undefined, speaker, {
      context: req.body.context,
      level: req.body.level,
      pace: req.body.pace,
      voiceId: req.body.context === 'listening' ? ELEVENLABS_LISTENING_NARRATOR_VOICE_ID : undefined,
    });
    res.setHeader('X-TTS-Cache-Key', audio.cacheKey);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type(audio.contentType).send(audio.buffer);
  }),
);

export default router;
