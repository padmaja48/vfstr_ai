import { z } from 'zod';
import { Resume } from '../models/Resume';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { analyzeResume, extractResumeSkillsHeuristic } from '../services/ai.service';
import { uploadBuffer } from '../services/storage.service';
import {
  extractResumeText,
  isFailedExtractionPlaceholder,
  resumeContentHash,
} from '../services/resume-parser.service';
import {
  assertUserInAdminScope,
  resourceFilterForScope,
  scopeFromRequest,
} from '../middleware/adminScope';

export const resumeParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

const isWeakSkillAnalysis = (skills?: string[]) => {
  const normalized = (skills ?? []).map((skill) => skill.trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return true;
  return (
    normalized.length <= 2
    && normalized.every((skill) => skill === 'communication' || skill === 'problem solving')
  );
};

/** L04: never expose raw Cloudinary/storage URLs on resume JSON responses. */
const toSafeResumeJson = (resume: { toJSON?: () => Record<string, unknown> }, includeFileUrl = false) => {
  const json = (typeof resume.toJSON === 'function' ? resume.toJSON() : { ...(resume as object) }) as Record<
    string,
    unknown
  >;
  if (!includeFileUrl) {
    delete json.fileUrl;
    delete json.filePublicId;
  }
  return json;
};

export const uploadResume = asyncHandler(async (req, res) => {
  const pastedText = typeof req.body.resumeText === 'string' ? req.body.resumeText.trim() : '';

  if (!req.file && pastedText.length < 50) {
    throw new AppError('Resume file or pasted resume text is required', 400, 'RESUME_REQUIRED');
  }

  if (req.file?.buffer?.length) {
    const buf = req.file.buffer;
    const name = (req.file.originalname || '').toLowerCase();
    const isPdf = name.endsWith('.pdf') || req.file.mimetype === 'application/pdf';
    const isDocx = name.endsWith('.docx')
      || req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const isZipMagic = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
    const isPdfMagic = buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';

    if (isPdf && !isPdfMagic) {
      throw new AppError('Uploaded file is not a valid PDF', 400, 'RESUME_INVALID_TYPE');
    }
    if (isDocx && !isZipMagic) {
      throw new AppError('Uploaded file is not a valid DOCX', 400, 'RESUME_INVALID_TYPE');
    }
  }

  // 1. Extract full text from the file (PDF / DOCX / TXT)
  const extraction = await extractResumeText(
    req.file?.buffer ?? Buffer.from(pastedText),
    req.file?.originalname ?? 'pasted-resume.txt',
    req.file?.mimetype ?? 'text/plain',
    pastedText,
  );

  const rawText = extraction.text;
  if (
    !rawText
    || rawText.length < 50
    || extraction.parseStatus === 'failed'
    || extraction.parseStatus === 'scanned_likely'
    || isFailedExtractionPlaceholder(rawText)
  ) {
    throw new AppError(
      extraction.warning
        || 'Could not extract readable text from the resume. Please upload a PDF or DOCX with selectable text, or paste your resume text in the form.',
      400,
      extraction.parseStatus === 'scanned_likely' ? 'RESUME_SCANNED_PDF' : 'RESUME_PARSE_FAILED',
    );
  }

  // 2. Compute content hash to detect duplicate uploads
  const hash = resumeContentHash(rawText);

  // 3. If this user already uploaded the exact same resume content, return the existing record
  //    (re-analyze first when a prior upload only captured soft-skill placeholders)
  const existing = await Resume.findOne({ userId: req.userId, contentHash: hash });
  if (existing) {
    if (isWeakSkillAnalysis(existing.analysis?.skills)) {
      const analysis = await Promise.race([
        analyzeResume(rawText, { userId: String(req.userId) }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new AppError(
            'Resume analysis is taking too long for this large document. Please paste a shorter version (1–3 pages) or try again.',
            408,
            'RESUME_ANALYSIS_TIMEOUT',
          )), 55_000);
        }),
      ]);
      const heuristicSkills = extractResumeSkillsHeuristic(rawText);
      existing.analysis = {
        ...existing.analysis,
        ...analysis,
        skills: analysis.skills?.length ? analysis.skills : heuristicSkills,
      };
      existing.markModified('analysis');
      await existing.save();
      return res.status(200).json({
        ...toSafeResumeJson(existing, false),
        _reanalyzed: true,
        _warning: extraction.warning,
        parseStatus: extraction.parseStatus,
      });
    }
    return res.status(200).json({
      ...toSafeResumeJson(existing, false),
      _duplicate: true,
      _warning: extraction.warning,
      parseStatus: extraction.parseStatus,
    });
  }

  // 4. Upload original file, or store pasted resume text as a text resume artifact.
  const storedFile = req.file
    ? await uploadBuffer(req.file, 'resumes')
    : await uploadBuffer({
        buffer: Buffer.from(rawText),
        originalname: 'pasted-resume.txt',
        mimetype: 'text/plain',
      } as Express.Multer.File, 'resumes');

  // 5. AI analysis — always run fresh on new unique resumes (J09: cap wait on large docs)
  const analysis = await Promise.race([
    analyzeResume(rawText, { userId: String(req.userId) }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new AppError(
        'Resume analysis is taking too long for this large document. Please paste a shorter version (1–3 pages) or try again.',
        408,
        'RESUME_ANALYSIS_TIMEOUT',
      )), 55_000);
    }),
  ]);

  // 6. Save to DB
  const resume = await Resume.create({
    userId: req.userId,
    fileUrl: storedFile.url,
    filePublicId: storedFile.publicId,
    fileName: req.file?.originalname ?? 'Pasted Resume Text',
    rawText,
    contentHash: hash,
    analysis,
  });

  return res.status(201).json({
    ...toSafeResumeJson(resume, false),
    _warning: extraction.warning,
    parseStatus: extraction.parseStatus,
  });
});

export const getResumeHistory = asyncHandler(async (req, res) => {
  const resumes = await Resume.find({ userId: req.userId }).sort({ createdAt: -1 });
  // L04: do not leak raw storage URLs in list responses.
  res.json(resumes.map((resume) => toSafeResumeJson(resume, false)));
});

export const getResume = asyncHandler(async (req, res) => {
  const resume = await Resume.findOne({ _id: req.params.id, userId: req.userId });
  if (!resume) {
    throw new AppError('Resume not found', 404, 'RESUME_NOT_FOUND');
  }
  // Owner-only fetch; still omit direct file URL from JSON — rawText/analysis is enough for interview.
  res.json(toSafeResumeJson(resume, false));
});

/** Admin: resumes scoped to caller's institution. */
export const adminListResumes = asyncHandler(async (req, res) => {
  const scope = scopeFromRequest(req);
  const filter = await resourceFilterForScope(scope);

  const resumes = await Resume.find(filter)
    .populate('userId', 'name email institution institutionId batch branch')
    .sort({ createdAt: -1 });
  res.json(resumes.map((resume) => toSafeResumeJson(resume, false)));
});

/** Admin: single resume — scoped. */
export const adminGetResume = asyncHandler(async (req, res) => {
  const resume = await Resume.findById(req.params.id).populate('userId', 'name email institution institutionId');
  if (!resume) {
    throw new AppError('Resume not found', 404, 'RESUME_NOT_FOUND');
  }

  const ownerId = typeof resume.userId === 'object' && resume.userId?._id
    ? String(resume.userId._id)
    : String(resume.userId);
  await assertUserInAdminScope(scopeFromRequest(req), ownerId);

  res.json(toSafeResumeJson(resume, false));
});
