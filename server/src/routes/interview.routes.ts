import { Router } from 'express';
import multer from 'multer';
import {
  adminGetInterview,
  adminGetInterviewReportPdf,
  adminListInterviews,
  answerSchema,
  completeInterview,
  createInterview,
  createInterviewSchema,
  getInterview,
  getInterviewReport,
  getInterviewReportPdf,
  getInterviewState,
  getUserInterviews,
  interviewParamsSchema,
  logViolation,
  logViolationSchema,
  logFaceIncident,
  logFaceIncidentSchema,
  terminateInterview,
  terminateInterviewSchema,
  personaPreviewSchema,
  personaVoicePreview,
  speakSchema,
  startInterview,
  startInterviewSchema,
  submitAnswer,
  synthesizeQuestion,
  transcribeRecording,
  uploadRecording,
} from '../controllers/interview.controller';
import { authenticate, requireAccountSetupComplete, requireActiveAccount } from '../middleware/auth';
import { authorizeAdmin, authorizeSuperAdmin } from '../middleware/adminScope';
import { interviewStartGate } from '../middleware/concurrencyGate';
import { speakLimiter, transcribeLimiter, aiLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'video/webm',
  'application/octet-stream',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const extOk = /\.(webm|wav|mp3|mp4|m4a|ogg|oga)$/.test(name) || !name.includes('.');
    if (ALLOWED_AUDIO_MIMES.has(file.mimetype) && extOk) {
      cb(null, true);
      return;
    }
    cb(new Error('Only audio recordings (webm, wav, mp3, mp4, ogg) are allowed'));
  },
});

const router = Router();

router.use(authenticate);
router.use(requireActiveAccount);
router.use(requireAccountSetupComplete);
router.post('/persona-preview', speakLimiter, validate(personaPreviewSchema), personaVoicePreview);
router.post('/', interviewStartGate, validate(createInterviewSchema), createInterview);
router.get('/user-interviews', getUserInterviews);
router.get('/admin/all', authorizeAdmin, adminListInterviews);
router.get('/admin/:id/report/pdf', authorizeAdmin, validate(interviewParamsSchema), adminGetInterviewReportPdf);
router.get('/admin/:id', authorizeAdmin, validate(interviewParamsSchema), adminGetInterview);
router.post('/start', interviewStartGate, aiLimiter, validate(startInterviewSchema), startInterview);
router.post('/answer', aiLimiter, validate(answerSchema), submitAnswer);
router.post('/complete', aiLimiter, completeInterview);
router.get('/:id', validate(interviewParamsSchema), getInterview);
router.post('/:id/start', interviewStartGate, aiLimiter, startInterview);
router.post('/:id/answer', aiLimiter, validate(answerSchema), submitAnswer);
router.post('/:id/complete', aiLimiter, completeInterview);
router.get('/:id/state', validate(interviewParamsSchema), getInterviewState);
router.post('/:id/speak', speakLimiter, validate(speakSchema), synthesizeQuestion);
router.post(
  '/:id/transcribe',
  transcribeLimiter,
  validate(interviewParamsSchema),
  upload.single('audio'),
  transcribeRecording,
);
router.post('/:id/recording', validate(interviewParamsSchema), upload.single('recording'), uploadRecording);
router.patch('/:id/violation', validate(logViolationSchema), logViolation);
router.patch('/:id/face-incident', validate(logFaceIncidentSchema), logFaceIncident);
router.post('/:id/terminate', validate(terminateInterviewSchema), terminateInterview);
router.get('/:id/report/pdf', validate(interviewParamsSchema), getInterviewReportPdf);
router.get('/:id/report', validate(interviewParamsSchema), getInterviewReport);

export default router;
