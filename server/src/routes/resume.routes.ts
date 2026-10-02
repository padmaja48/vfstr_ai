import { Router } from 'express';
import multer from 'multer';
import {
  adminGetResume,
  adminListResumes,
  getResume,
  getResumeHistory,
  resumeParamsSchema,
  uploadResume,
} from '../controllers/resume.controller';
import { authenticate, requireAccountSetupComplete, requireActiveAccount } from '../middleware/auth';
import { authorizeAdmin } from '../middleware/adminScope';
import { aiLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';

const ALLOWED_RESUME_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const extOk = /\.(pdf|docx?|txt)$/.test(name);
    const mimeOk = ALLOWED_RESUME_MIMES.has(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (extOk && mimeOk) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PDF, DOC, DOCX, or TXT resumes are allowed'));
  },
});

const router = Router();

router.use(authenticate);
router.use(requireActiveAccount);
router.use(requireAccountSetupComplete);
router.post('/', aiLimiter, upload.single('resume'), uploadResume);
router.get('/', getResumeHistory);
router.get('/admin/all', authorizeAdmin, adminListResumes);
router.get('/admin/:id', authorizeAdmin, validate(resumeParamsSchema), adminGetResume);
router.get('/:id', validate(resumeParamsSchema), getResume);

export default router;
