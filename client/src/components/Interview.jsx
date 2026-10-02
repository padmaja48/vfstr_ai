import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { interviewAPI, resumeAPI, userAPI } from '../services/api';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PERSONAS } from '../lib/personas';
import { COMPANY_OPTIONS } from '../lib/companyOptions';
import { createAudioRecorder, getRecordedAudioFileName } from '../lib/audioRecording';
import { getTtsApiErrorMessage, playProcessedTtsBlob, stopTtsAudio } from '../lib/ttsAudio';
import { normalizeSpeechTranscript } from '../lib/speechTranscriptNormalize';
import { buildCorrectedResumeText, extractResumePreview } from '../lib/resumePreview';
import {
  createPersonPresenceStabilizer,
  detectPersonPresence,
  preloadFacePresenceModel,
} from '../lib/facePresence';
import { AvatarPortrait } from './interview/AvatarPortrait';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Mic,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import LiveCodingPanel, {
  detectLanguageFromQuestion,
  isCodingQuestion,
  isDesignQuestion,
  isLanguageStarter,
  languageStarter,
} from './interview/LiveCodingPanel';
import DesignWhiteboard from './interview/DesignWhiteboard';
import VoiceIndicator from './interview/VoiceIndicator';
import CompanySelectorDropdown from './interview/CompanySelectorDropdown';
import '../styles/Interview.css';

const STEPS = ['Resume', 'Review', 'Setup', 'Connection', 'Ready'];
const LIVE_STEP = 5;
const ACTIVE_INTERVIEW_KEY = 'fluentai_active_interview';
const ACTIVE_PERSONA_KEY = 'fluentai_active_persona';
const OPEN_REPORT_KEY = 'fluentai_open_report';
const NETWORK_CHECK_CACHE_KEY = 'fluentai_connection_check_cache';
const NETWORK_CHECK_CACHE_TTL_MS = 2 * 60 * 1000;
const NETWORK_CHECK_TIMEOUT_MS = 5000;
const NETWORK_CHECK_AUTO_ADVANCE_MS = 1000;
const NETWORK_CHECK_URL = '/api/health';

const truncateToast = (text, max = 160) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
};

const toastEvaluationFeedback = (toast, evaluation) => {
  if (!evaluation || !toast) return;
  const feedback = truncateToast(
    evaluation.feedback
    || evaluation.dynamicFeedback?.areasToImprove?.[0]
    || evaluation.dynamicFeedback?.strengths?.[0]
    || '',
    150,
  );
  if (!feedback) return;
  const score = Number.isFinite(Number(evaluation.score)) ? Number(evaluation.score) : null;
  const message = score != null
    ? `Answer feedback · Score ${score}/100 — ${feedback}`
    : `Answer feedback — ${feedback}`;
  if (score != null && score >= 70) toast.success(message, { duration: 5600 });
  else if (score != null && score < 50) toast.warning(message, { duration: 5600 });
  else toast.info(message, { duration: 5600 });
};

const complexityForLevel = (roleLevel) => {
  if (roleLevel === 'Fresher') return 'Beginner';
  if (roleLevel === 'Senior' || roleLevel === 'Lead') return 'Advanced';
  return 'Intermediate';
};
const ROLE_OPTIONS = [
  { label: 'SDE', value: 'SDE', mode: 'sde' },
  { label: 'Data Analyst', value: 'Data Analyst', mode: 'data_analyst' },
  { label: 'AI/ML', value: 'AI/ML Engineer', mode: 'ai_ml' },
  { label: 'Frontend', value: 'Frontend Developer', mode: 'frontend' },
  { label: 'Backend', value: 'Backend Developer', mode: 'backend' },
  { label: 'QA', value: 'QA Engineer', mode: 'qa' },
  { label: 'HR/Behavioral', value: 'HR / Behavioral', mode: 'hr_behavioral' },
];
const PERSON_CHECK_INTERVAL_MS = 500;
const PERSON_MISSING_GRACE_MS = 5000;
const ANSWER_SILENCE_PROMPT_MS = 60000;
const MAX_LIVE_TRANSCRIPT_MESSAGES = 80;
const FULLSCREEN_RECHECK_MS = 1500;
const FOCUS_RECHECK_MS = 1500;
const VIOLATION_COOLDOWN_MS = 5000;
const INTERVIEW_TTS_PLAYBACK_SETTINGS = {
  volume: 1.35,
  speechRate: 1,
  pitch: 0,
  voiceStyle: 'default',
};
const isLikelyMobileDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent));

const supportsFullscreen = () =>
  typeof document !== 'undefined'
  && Boolean(
    document.documentElement.requestFullscreen
    || document.documentElement.webkitRequestFullscreen,
  );

const getFullscreenElement = () =>
  document.fullscreenElement
  || document.webkitFullscreenElement
  || document.webkitCurrentFullScreenElement
  || null;

const isAppFullscreen = () => Boolean(getFullscreenElement());

const formatFullscreenError = (error) => {
  if (!error) return 'Fullscreen request was denied.';
  const name = error.name || '';
  if (name === 'NotAllowedError') {
    return 'Fullscreen must be started from a button click in this tab (browser blocked the request).';
  }
  if (name === 'SecurityError') {
    return 'Fullscreen is blocked here (permissions policy or embedded frame).';
  }
  return error.message || String(error);
};

const requestAppFullscreen = () => {
  const el = document.documentElement;
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  return Promise.reject(new Error('Fullscreen API is not available.'));
};

const exitAppFullscreen = () => {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  return Promise.resolve(false);
};

/** Call synchronously from a user-gesture handler (click / keydown). */
const enterInterviewFullscreen = async ({ logLabel = 'interview', toast } = {}) => {
  if (!supportsFullscreen()) {
    console.info('[fullscreen] API not supported in this browser.');
    return { ok: false, reason: 'unsupported' };
  }
  if (isAppFullscreen()) {
    return { ok: true, reason: 'already' };
  }
  try {
    await requestAppFullscreen();
    console.info(`[fullscreen] entered (${logLabel})`);
    return { ok: true, reason: 'entered' };
  } catch (error) {
    const message = formatFullscreenError(error);
    console.warn(`[fullscreen] ${logLabel} failed:`, message, error);
    toast?.warning?.(`Fullscreen could not start: ${message}`);
    return { ok: false, reason: message, error };
  }
};

const isClipboardShortcut = (event) => {
  const key = event.key.toUpperCase();
  return (
    ((event.ctrlKey || event.metaKey) && ['C', 'X', 'V'].includes(key)) ||
    (event.shiftKey && event.key === 'Insert')
  );
};

const isBlockedInterviewShortcut = (event) => {
  const key = event.key.toUpperCase();
  return (
    isClipboardShortcut(event) ||
    event.key === 'F12' ||
    ((event.ctrlKey || event.metaKey) && event.shiftKey && ['I', 'J', 'C', 'U'].includes(key)) ||
    ((event.ctrlKey || event.metaKey) && ['A', 'P', 'S', 'U'].includes(key)) ||
    (event.altKey && event.key === 'Tab')
  );
};

const PROCTOR_STATUS_LABELS = {
  ok: 'PERSON OK',
  missing: 'PERSON CHECK',
  off: 'CAMERA OFF',
  checking: 'PERSON CHECK',
};

const safeSessionRead = (key) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSessionWrite = (key, value) => {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* ignore persistence failures */
  }
};

const readCachedNetworkCheck = () => {
  try {
    const raw = safeSessionRead(NETWORK_CHECK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.measuredAt || Date.now() - parsed.measuredAt > NETWORK_CHECK_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const cacheNetworkCheck = (result) => {
  safeSessionWrite(NETWORK_CHECK_CACHE_KEY, JSON.stringify({ ...result, measuredAt: Date.now() }));
};

const getConnectionInfo = () => {
  if (typeof navigator === 'undefined') return null;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return null;
  const downlink = Number(connection.downlink);
  const rtt = Number(connection.rtt);
  return {
    effectiveType: connection.effectiveType || '',
    downlinkMbps: Number.isFinite(downlink) && downlink > 0 ? downlink : null,
    rttMs: Number.isFinite(rtt) && rtt > 0 ? rtt : null,
    saveData: Boolean(connection.saveData),
  };
};

const estimateUploadMbps = (downlinkMbps) => (
  Number.isFinite(downlinkMbps) && downlinkMbps > 0 ? Number((downlinkMbps * 0.7).toFixed(1)) : null
);

const classifyNetworkQuality = ({ downlinkMbps, rttMs, effectiveType, saveData }) => {
  if (saveData) {
    if (downlinkMbps != null && downlinkMbps >= 1.5 && (rttMs == null || rttMs <= 400)) return 'fair';
    return 'poor';
  }

  if (downlinkMbps != null) {
    if (downlinkMbps >= 5 && (rttMs == null || rttMs <= 150)) return 'good';
    if (downlinkMbps >= 1.5 && (rttMs == null || rttMs <= 400)) return 'fair';
    return 'poor';
  }

  if (effectiveType === '4g') {
    if (rttMs != null && rttMs <= 150) return 'good';
    return 'fair';
  }

  if (effectiveType === '3g') {
    if (rttMs != null && rttMs <= 400) return 'fair';
    return 'poor';
  }

  return 'poor';
};

const measurePingRtt = async (signal) => {
  const startedAt = performance.now();
  const response = await fetch(`${NETWORK_CHECK_URL}?t=${Date.now()}`, {
    method: 'HEAD',
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok && response.status !== 200 && response.status !== 204) {
    throw new Error(`Ping check failed (${response.status})`);
  }
  return Math.round(performance.now() - startedAt);
};

const runConnectionCheckAttempt = async () => {
  const info = getConnectionInfo();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), NETWORK_CHECK_TIMEOUT_MS);
  try {
    const rttMs = await measurePingRtt(controller.signal);
    const downlinkMbps = info?.downlinkMbps ?? null;
    const uploadMbps = estimateUploadMbps(downlinkMbps);
    const tier = classifyNetworkQuality({
      downlinkMbps,
      rttMs: rttMs ?? info?.rttMs ?? null,
      effectiveType: info?.effectiveType,
      saveData: info?.saveData,
    });

    return {
      tier,
      downlinkMbps,
      uploadMbps,
      rttMs: rttMs ?? info?.rttMs ?? null,
      effectiveType: info?.effectiveType || null,
      measuredAt: Date.now(),
      source: info ? 'navigator.connection + ping' : 'ping',
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const buildFallbackNetworkResult = () => {
  const info = getConnectionInfo();
  const tier = classifyNetworkQuality({
    downlinkMbps: info?.downlinkMbps ?? null,
    rttMs: info?.rttMs ?? null,
    effectiveType: info?.effectiveType,
    saveData: info?.saveData,
  });

  return {
    tier,
    downlinkMbps: info?.downlinkMbps ?? null,
    uploadMbps: estimateUploadMbps(info?.downlinkMbps ?? null),
    rttMs: info?.rttMs ?? null,
    effectiveType: info?.effectiveType || null,
    measuredAt: Date.now(),
    source: info ? 'navigator.connection fallback' : 'unknown fallback',
  };
};

/* ─────────────────────────────────────────────────────────────────
   Shared helpers
───────────────────────────────────────────────────────────────── */
function InterviewLoader({ title = 'Preparing VFSTR.AI interview', message = 'Please wait…' }) {
  return (
    <div className="iv-loading-card" role="status" aria-live="polite">
      <div className="iv-loader-orbit" aria-hidden="true"><span /><span /><span /></div>
      <div><h3>{title}</h3><p>{message}</p></div>
    </div>
  );
}

function MobileBlockedInterview({ onBack }) {
  useEffect(() => {
    window.alert('AI interviews require a laptop or desktop. Please continue on a larger device with a camera and microphone.');
  }, []);

  return (
    <div className="iv-container">
      <div className="iv-mobile-block">
        <span className="iv-mobile-block-icon">!</span>
        <h2>Use a Laptop or Desktop</h2>
        <p>
          AI interviews on VFSTR.AI need desktop-style camera and microphone support.
          Please continue from a laptop or desktop browser.
        </p>
        <button type="button" className="iv-btn iv-btn--primary" onClick={() => onBack?.('dashboard')}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}

const playAudioBlob = (blob, options = {}) =>
  playProcessedTtsBlob(blob, {
    settings: options.settings ?? INTERVIEW_TTS_PLAYBACK_SETTINGS,
    diagnosticsLabel: options.diagnosticsLabel ?? 'interview',
    ...options,
  });

const ttsErrorMessage = getTtsApiErrorMessage;

const speakWithBrowserVoice = (text, { rate = 1, onStart, onEnd, onError } = {}) =>
  new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || !text?.trim()) {
      onError?.(new Error('Browser speech synthesis is unavailable'));
      resolve(false);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.trim());
      utterance.lang = 'en-IN';
      utterance.rate = Math.min(1.2, Math.max(0.8, Number(rate) || 1));
      utterance.onstart = () => onStart?.();
      utterance.onend = () => {
        onEnd?.();
        resolve(true);
      };
      utterance.onerror = () => {
        onError?.(new Error('Browser speech synthesis failed'));
        resolve(false);
      };
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      onError?.(error);
      resolve(false);
    }
  });

const splitSkillList = (value) =>
  String(value || '')
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(item => item.length >= 2 && item.length <= 48);

/** Newline = separate item only when the user edited the review boxes. */
const splitMultilineItems = (value) =>
  String(value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);

/* ─────────────────────────────────────────────────────────────────
   Step 1: Resume Upload
───────────────────────────────────────────────────────────────── */
function ResumeStep({ onNext }) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [resume, setResume] = useState(null);
  const [resumeText, setResumeText] = useState('');
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    resumeAPI.getHistory()
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        const pasted = list.find((item) =>
          /pasted resume text/i.test(String(item.fileName || item.originalName || '')),
        ) || list[0];
        setHistory(pasted ? [pasted] : []);
      })
      .catch(() => {});
  }, []);

  const upload = async () => {
    const pastedText = resumeText.trim();
    if (pastedText.length < 50) {
      const msg = 'Paste at least 50 characters of resume text.';
      setError(msg);
      toast.error(msg);
      return;
    }
    try {
      setUploading(true); setError('');
      const fd = new FormData();
      fd.append('resumeText', pastedText);
      const res = await resumeAPI.upload(fd);
      setResume(res.data);
      if (res.data?._warning) {
        setError(res.data._warning);
        toast.warning(res.data._warning);
      } else if (res.data?._duplicate) {
        setError('');
        toast.info('Same resume detected — reusing your existing analysis.');
      } else {
        setError('');
        toast.success('Resume analyzed successfully.');
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message
        || err?.response?.data?.error
        || 'Could not analyze resume text. Please try again.';
      setError(msg);
      toast.error(msg);
    }
    finally { setUploading(false); }
  };

  return (
    <div className="iv-step iv-step--pro">
      <header className="iv-step-head">
        <p className="iv-step-kicker">Step 1 of 5</p>
        <h2 className="iv-step-title">Resume</h2>
        <p className="iv-step-desc">Paste your resume text so VFSTR.AI can tailor interview questions to your experience.</p>
      </header>
      <div className="iv-resume-text-block">
        <label className="iv-label" htmlFor="resume-text-input">Resume text</label>
        <textarea
          id="resume-text-input"
          className="iv-input iv-textarea"
          value={resumeText}
          onChange={e => {
            setResumeText(e.target.value);
            if (resume?.fileName === 'Pasted Resume Text') setResume(null);
          }}
          placeholder="Paste your resume text here for cleaner role and skill matching."
          rows={12}
          disabled={uploading}
        />
        <div className="iv-resume-text-actions">
          <button
            type="button"
            className="iv-btn iv-btn--analyze"
            disabled={uploading || resumeText.trim().length < 50}
            onClick={() => upload()}
          >
            {uploading ? 'Analyzing…' : 'Analyze pasted text'}
          </button>
        </div>
      </div>
      {error && <p className="iv-error">{error}</p>}
      {resume?._duplicate && (
        <p className="iv-info-note">✓ Same resume detected — reusing your existing analysis.</p>
      )}
      {resume && !uploading && (
        <p className="iv-info-note">✓ {resume.fileName || resume.originalName || 'Resume ready'}</p>
      )}
      {history.length > 0 && !resume && (
        <div className="iv-resume-history">
          <p className="iv-resume-history-label">Or use your last pasted resume:</p>
          <div className="iv-resume-history-list">
            {history.map(r => (
              <button key={r._id} type="button" className="iv-btn iv-btn--ghost" onClick={() => setResume(r)}>
                {r.fileName || r.originalName || 'Last pasted resume'}
              </button>
            ))}
          </div>
        </div>
      )}
      {resume && (
        <div className="iv-step-actions">
          <button className="iv-btn iv-btn--primary" onClick={() => onNext({ resume })}>
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Step 3: Resume Intelligence Preview
───────────────────────────────────────────────────────────────── */
function ResumeIntelligenceStep({ resume, onNext, onBack }) {
  const previewKey = `${resume?._id || ''}:${String(resume?.rawText || resume?.extractedText || '').slice(0, 120)}`;
  const buildDraftFromResume = (source) => {
    const preview = extractResumePreview(source);
    return {
      skills: preview.skills.join('\n'),
      projects: preview.projects.join('\n'),
      internships: preview.internships.join('\n'),
      certifications: preview.certifications.join('\n'),
    };
  };
  const [draft, setDraft] = useState(() => buildDraftFromResume(resume));

  useEffect(() => {
    setDraft(buildDraftFromResume(resume));
  }, [previewKey]);

  const updateDraft = (key, value) => setDraft(prev => ({ ...prev, [key]: value }));
  const structured = {
    skills: splitSkillList(draft.skills),
    projects: splitMultilineItems(draft.projects),
    internships: splitMultilineItems(draft.internships),
    certifications: splitMultilineItems(draft.certifications),
  };

  const fields = [
    ['skills', 'Skills', 'Add one skill per line (e.g. React, SQL)'],
    ['projects', 'Projects', 'One project per line'],
    ['internships', 'Internships / Work Experience', 'One role per line (e.g. SDE Intern at Acme Corp)'],
    ['certifications', 'Certifications', 'One certification per line'],
  ];

  return (
    <div className="iv-step iv-step--wide iv-step--resume-review">
      <span className="iv-step-kicker">Resume intelligence</span>
      <h2 className="iv-step-title">Review what we extracted</h2>
      <p className="iv-step-desc">
        Edit any field below — even if nothing looks wrong. These values guide your interview questions.
      </p>
      <p className="iv-review-edit-hint" role="note">
        Click any box to edit. One item per line. Empty fields are fine.
      </p>

      <div className="iv-resume-preview-grid">
        {fields.map(([key, label, placeholder]) => (
          <label key={key} className="iv-preview-field">
            <span>
              {label}
              <em className="iv-edit-affordance">Editable</em>
            </span>
            <textarea
              className="iv-input iv-textarea"
              value={draft[key]}
              onChange={event => updateDraft(key, event.target.value)}
              placeholder={placeholder}
              rows={5}
            />
          </label>
        ))}
      </div>

      <div className="iv-profile-summary iv-profile-summary--review">
        <div><strong>{structured.skills.length}</strong><span>Skills</span></div>
        <div><strong>{structured.projects.length}</strong><span>Projects</span></div>
        <div><strong>{structured.internships.length}</strong><span>Experience</span></div>
        <div><strong>{structured.certifications.length}</strong><span>Certifications</span></div>
      </div>

      <div className="iv-step-actions iv-step-actions--review">
        <button type="button" className="iv-btn iv-btn--ghost" onClick={onBack}>← Back</button>
        <button
          type="button"
          className="iv-btn iv-btn--primary"
          onClick={() => onNext({
            resumeProfileEdits: structured,
            correctedResumeText: buildCorrectedResumeText(resume, structured),
          })}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Step 4: Persona Selection — with voice preview
───────────────────────────────────────────────────────────────── */
function PersonaStep({ onNext, onBack }) {
  const toast = useToast();
  const [selected, setSelected] = useState(null);
  const [previewing, setPreviewing] = useState(null); // persona id currently previewing
  const [previewError, setPreviewError] = useState('');
  const previewAudioRef = useRef(null);

  const stopPreview = () => {
    stopTtsAudio(previewAudioRef.current);
    previewAudioRef.current = null;
    setPreviewing(null);
  };

  const playPreviewBrowserFallback = (persona) =>
    speakWithBrowserVoice(persona.intro || `Hi, I'm ${persona.name}. I'll be your interviewer today.`, {
      rate: 1,
      onStart: () => setPreviewing(persona.id),
      onEnd: () => setPreviewing(null),
      onError: () => {
        setPreviewing(null);
        const msg = 'Voice preview unavailable. Audio is down — you can still continue setup.';
        setPreviewError(msg);
        toast.warning(msg);
      },
    });

  const handlePreview = async (persona, e) => {
    e.stopPropagation(); // don't select the card
    if (previewing === persona.id) { stopPreview(); try { window.speechSynthesis?.cancel(); } catch {} return; }
    stopPreview();
    try { window.speechSynthesis?.cancel(); } catch {}
    setPreviewError('');
    setPreviewing(persona.id);
    try {
      const res = await interviewAPI.personaPreview(persona.id);
      const audio = await playAudioBlob(res.data, {
        onPlay: (audioElement) => {
          previewAudioRef.current = audioElement;
        },
        onEnded: () => {
          previewAudioRef.current = null;
          setPreviewing(null);
        },
        onError: () => {
          previewAudioRef.current = null;
          setPreviewing(null);
          const msg = 'Cloud voice failed — trying browser voice…';
          setPreviewError(msg);
          toast.info(msg);
          playPreviewBrowserFallback(persona);
        },
      });
      previewAudioRef.current = audio;
    } catch (error) {
      previewAudioRef.current = null;
      const fallbackMsg = await ttsErrorMessage(error, 'Cloud voice unavailable — trying browser voice…');
      setPreviewError(fallbackMsg);
      toast.info(fallbackMsg);
      const played = await playPreviewBrowserFallback(persona);
      if (!played) {
        setPreviewing(null);
        const msg = 'Voice preview unavailable. Audio is down — you can still continue setup.';
        setPreviewError(msg);
        toast.warning(msg);
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => () => stopPreview(), []);

  return (
    <div className="iv-step">
      <h2 className="iv-step-title">Choose Your Interviewer</h2>
      <p className="iv-step-desc">
        Click a card to select. Press <strong>Preview voice</strong> to hear how they sound before deciding.
      </p>
      {previewError && <p className="iv-error">{previewError}</p>}

      <div className="iv-persona-grid">
        {PERSONAS.map(p => (
          <div
            key={p.id}
            className={`iv-persona-card${selected?.id === p.id ? ' iv-persona-card--selected' : ''}`}
            onClick={() => setSelected(p)}
          >
            <div className="iv-persona-avatar">
              <AvatarPortrait persona={p} isSpeaking={previewing === p.id} audioLevel={previewing === p.id ? 0.6 : 0} />
            </div>
            <div className="iv-persona-info">
              <h3 className="iv-persona-name">{p.name}</h3>
            </div>

            {/* Voice preview button */}
            <button
              className={`iv-preview-btn${previewing === p.id ? ' iv-preview-btn--active' : ''}`}
              onClick={e => handlePreview(p, e)}
              title={previewing === p.id ? 'Stop preview' : 'Preview voice'}
            >
              {previewing === p.id ? (
                <>Stop</>
              ) : (
                <>Preview voice</>
              )}
            </button>

            {selected?.id === p.id && <span className="iv-persona-check">✓</span>}
          </div>
        ))}
      </div>

      <div className="iv-step-actions">
        <button className="iv-btn iv-btn--ghost" onClick={() => { stopPreview(); onBack(); }}>← Back</button>
        <button className="iv-btn iv-btn--primary" disabled={!selected}
          onClick={() => { stopPreview(); onNext({ persona: selected }); }}>
          Continue →
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Step 3: Setup — interviewer + optional JD/company + duration
───────────────────────────────────────────────────────────────── */
function ConfigStep({ onNext, onBack }) {
  const toast = useToast();
  const { user, setUser } = useContext(AuthContext);
  const [selectedPersona, setSelectedPersona] = useState(PERSONAS[0]);
  const [previewing, setPreviewing] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [recentCompanies, setRecentCompanies] = useState([]);
  const [companySelectorOpen, setCompanySelectorOpen] = useState(false);
  const [jobDescriptionHintVisible, setJobDescriptionHintVisible] = useState(false);
  const previewAudioRef = useRef(null);
  const jobDescriptionRef = useRef(null);
  const jobDescriptionHintTimerRef = useRef(null);
  const [config, setConfig] = useState({
    roleLevel: 'Fresher',
    roleDomain: ROLE_OPTIONS[0].value,
    interviewMode: ROLE_OPTIONS[0].mode,
    jobDescription: '',
    interviewType: 'Mixed',
    duration: 30,
    targetCompany: '',
  });

  useEffect(() => {
    const accountRecentCompanies = Array.isArray(user?.companySelectorRecentCompanies)
      ? user.companySelectorRecentCompanies
      : [];
    setRecentCompanies(accountRecentCompanies.slice(0, 6));
  }, [user?.id, user?.companySelectorRecentCompanies]);

  const stopPreview = () => {
    stopTtsAudio(previewAudioRef.current);
    previewAudioRef.current = null;
    setPreviewing(null);
  };

  const autoResizeJobDescription = useCallback(() => {
    const textarea = jobDescriptionRef.current;
    if (!textarea) return;

    const maxHeight = 168;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => () => stopPreview(), []);

  useEffect(() => {
    autoResizeJobDescription();
  }, [autoResizeJobDescription, config.jobDescription]);

  useEffect(() => () => {
    if (jobDescriptionHintTimerRef.current) {
      window.clearTimeout(jobDescriptionHintTimerRef.current);
    }
  }, []);

  const playPreviewBrowserFallback = (persona) =>
    speakWithBrowserVoice(persona.intro || `Hi, I'm ${persona.name}. I'll be your interviewer today.`, {
      rate: 1,
      onStart: () => setPreviewing(persona.id),
      onEnd: () => setPreviewing(null),
      onError: () => {
        setPreviewing(null);
        const msg = 'Voice preview unavailable. Audio is down — you can still continue setup.';
        setPreviewError(msg);
        toast.warning(msg);
      },
    });

  const handlePreview = async (persona, e) => {
    e.stopPropagation();
    if (previewing === persona.id) { stopPreview(); try { window.speechSynthesis?.cancel(); } catch {} return; }
    stopPreview();
    try { window.speechSynthesis?.cancel(); } catch {}
    setPreviewError('');
    setPreviewing(persona.id);
    try {
      const res = await interviewAPI.personaPreview(persona.id);
      const audio = await playAudioBlob(res.data, {
        onPlay: (audioElement) => { previewAudioRef.current = audioElement; },
        onEnded: () => { previewAudioRef.current = null; setPreviewing(null); },
        onError: () => {
          previewAudioRef.current = null;
          const msg = 'Cloud voice failed — trying browser voice…';
          setPreviewError(msg);
          toast.info(msg);
          playPreviewBrowserFallback(persona);
        },
      });
      previewAudioRef.current = audio;
    } catch (error) {
      previewAudioRef.current = null;
      const fallbackMsg = await ttsErrorMessage(error, 'Cloud voice unavailable — trying browser voice…');
      setPreviewError(fallbackMsg);
      toast.info(fallbackMsg);
      const played = await playPreviewBrowserFallback(persona);
      if (!played) {
        setPreviewing(null);
        const msg = 'Voice preview unavailable. Audio is down — you can still continue setup.';
        setPreviewError(msg);
        toast.warning(msg);
      }
    }
  };

  const toggle = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));
  const handleJobDescriptionChange = (event) => {
    const value = event.target.value.slice(0, 3000);
    toggle('jobDescription', value);
    setJobDescriptionHintVisible(true);
    if (jobDescriptionHintTimerRef.current) {
      window.clearTimeout(jobDescriptionHintTimerRef.current);
    }
    jobDescriptionHintTimerRef.current = window.setTimeout(() => setJobDescriptionHintVisible(false), 2200);
    autoResizeJobDescription();
  };

  const handleJobDescriptionBlur = () => {
    const trimmed = config.jobDescription.trim();
    if (trimmed !== config.jobDescription) {
      toggle('jobDescription', trimmed);
    }
    autoResizeJobDescription();
  };

  const jobDescriptionCount = config.jobDescription.length;
  const updateRecentCompanies = useCallback(async (nextRecentCompanies) => {
    const normalized = Array.from(new Set((nextRecentCompanies || []).filter(Boolean))).slice(0, 6);
    setRecentCompanies(normalized);

    if (!user) return;

    try {
      const response = await userAPI.updateProfile({ companySelectorRecentCompanies: normalized });
      if (response?.data) {
        setUser(response.data);
      }
    } catch {
      // Recents are best-effort: the dropdown still works even if persistence fails.
    }
  }, [setUser, user]);
  const selectRole = (role) => setConfig(prev => ({
    ...prev,
    roleDomain: role.value,
    interviewMode: role.mode,
  }));
  const opts = (key, items, { ariaLabel, formatLabel } = {}) => (
    <div className="iv-toggle-group" role="group" aria-label={ariaLabel || key}>
      {items.map(item => (
        <button
          key={item}
          type="button"
          className={`iv-toggle-btn${config[key] === item ? ' iv-toggle-btn--active' : ''}`}
          aria-pressed={config[key] === item}
          onClick={() => toggle(key, item)}
        >
          {formatLabel ? formatLabel(item) : item}
        </button>
      ))}
    </div>
  );

  return (
    <div className="iv-step iv-step--setup iv-step--wide">
      <span className="iv-step-kicker">Interview setup</span>
      <h2 className="iv-step-title">Setup your interview</h2>
      <p className="iv-step-desc">
        Pick an interviewer, role, and duration. Job description and company are optional.
      </p>
      {previewError && <p className="iv-error">{previewError}</p>}

      <section className="iv-setup-section">
        <label className="iv-label" id="iv-interviewer-label">Interviewer</label>
        <div className="iv-persona-grid" role="radiogroup" aria-labelledby="iv-interviewer-label">
          {PERSONAS.filter(p => p.name !== 'Ananya Rao').map(p => (
            <div
              key={p.id}
              className={`iv-persona-card${selectedPersona?.id === p.id ? ' iv-persona-card--selected' : ''}`}
              onClick={() => setSelectedPersona(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedPersona(p);
                }
              }}
              role="radio"
              aria-checked={selectedPersona?.id === p.id}
              tabIndex={0}
            >
              <div className="iv-persona-avatar">
                <AvatarPortrait persona={p} isSpeaking={previewing === p.id} audioLevel={previewing === p.id ? 0.6 : 0} />
              </div>
              <div className="iv-persona-info">
                <h3 className="iv-persona-name">{p.name}</h3>
              </div>
              <button
                type="button"
                className={`iv-preview-btn${previewing === p.id ? ' iv-preview-btn--active' : ''}`}
                onClick={e => handlePreview(p, e)}
              >
                {previewing === p.id ? 'Stop preview' : 'Preview voice'}
              </button>
              {selectedPersona?.id === p.id && <span className="iv-persona-check" aria-hidden="true">✓</span>}
            </div>
          ))}
        </div>
      </section>

      <div className="iv-config-form">
        <section className="iv-setup-section">
          <label className="iv-label" id="iv-role-label">Target role</label>
          <div className="iv-choice-grid" role="group" aria-labelledby="iv-role-label">
            {ROLE_OPTIONS.map(role => (
              <button
                key={role.value}
                type="button"
                className={`iv-choice-card${config.roleDomain === role.value ? ' iv-choice-card--active' : ''}`}
                aria-pressed={config.roleDomain === role.value}
                onClick={() => selectRole(role)}
              >
                {role.label}
              </button>
            ))}
          </div>
        </section>

        <div className="iv-setup-inline">
          <section className="iv-setup-section">
            <label className="iv-label" id="iv-level-label">Experience level</label>
            {opts('roleLevel', ['Fresher'], { ariaLabel: 'Experience level' })}
          </section>
          <section className="iv-setup-section">
            <label className="iv-label" id="iv-duration-label">Duration</label>
            <div className="iv-toggle-group" role="group" aria-labelledby="iv-duration-label">
              <button
                type="button"
                className="iv-toggle-btn iv-toggle-btn--active"
                aria-pressed="true"
              >
                30 min
              </button>
            </div>
          </section>
        </div>

        <section className="iv-setup-section iv-setup-section--optional">
          <CompanySelectorDropdown
            id="target-company-selector"
            label={<><span>Target company</span> <span className="iv-optional">(optional)</span></>}
            value={config.targetCompany}
            onChange={(nextValue) => toggle('targetCompany', nextValue)}
            options={COMPANY_OPTIONS}
            recentValues={recentCompanies}
            onRecentValuesChange={updateRecentCompanies}
            onOpenChange={setCompanySelectorOpen}
          />
        </section>

        <section className="iv-setup-section iv-setup-section--optional">
          <div className="iv-job-description-field">
            <label className="iv-label" htmlFor="iv-job-description-input">
              Job description <span className="iv-optional">(optional)</span>
            </label>
            <div className="iv-job-description-wrap">
              <textarea
                id="iv-job-description-input"
                ref={jobDescriptionRef}
                className="iv-input iv-textarea iv-job-description-input"
              value={config.jobDescription}
              onChange={handleJobDescriptionChange}
              onBlur={handleJobDescriptionBlur}
              onPaste={() => {
                setJobDescriptionHintVisible(true);
                if (jobDescriptionHintTimerRef.current) {
                  window.clearTimeout(jobDescriptionHintTimerRef.current);
                }
                jobDescriptionHintTimerRef.current = window.setTimeout(() => setJobDescriptionHintVisible(false), 2200);
                window.requestAnimationFrame(autoResizeJobDescription);
              }}
              placeholder="Paste Job Description to tailor questions specifically."
              maxLength={3000}
              rows={4}
            />
            <span
              className={`iv-job-description-count${jobDescriptionCount > 2700 ? ' iv-job-description-count--warn' : ''}${jobDescriptionCount >= 3000 ? ' iv-job-description-count--danger' : ''}`}
            >
              {jobDescriptionCount} / 3000
            </span>
          </div>
          {jobDescriptionHintVisible && config.jobDescription.trim() ? (
            <p className="iv-job-description-hint">Questions will be tailored to this job description.</p>
          ) : null}
          </div>
        </section>
      </div>
      {!companySelectorOpen ? (
        <div className="iv-step-actions iv-step-actions--setup">
          <button type="button" className="iv-btn iv-btn--ghost" onClick={() => { stopPreview(); onBack(); }}>← Back</button>
          <button
            type="button"
            className="iv-btn iv-btn--primary"
            disabled={!selectedPersona}
            onClick={() => {
              stopPreview();
              onNext({
                persona: selectedPersona,
                config: {
                  ...config,
                  interviewType: 'Mixed',
                  complexity: complexityForLevel(config.roleLevel),
                },
              });
            }}
          >
            Continue →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NetworkCheckStep({ onNext, onBack }) {
  const [phase, setPhase] = useState('checking');
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('Checking your connection...');
  const autoAdvanceTimerRef = useRef(null);
  const requestIdRef = useRef(0);

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }, []);

  const advance = useCallback((tierOverride) => {
    clearAutoAdvance();
    onNext({ networkQualityTier: tierOverride || result?.tier || undefined });
  }, [clearAutoAdvance, onNext, result?.tier]);

  const setAndCacheResult = useCallback((nextResult, nextMessage) => {
    setResult(nextResult);
    setPhase(nextResult.tier);
    setMessage(nextMessage);
    cacheNetworkCheck(nextResult);
    clearAutoAdvance();
    if (nextResult.tier === 'good') {
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        onNext({ networkQualityTier: nextResult.tier });
      }, NETWORK_CHECK_AUTO_ADVANCE_MS);
    }
  }, [clearAutoAdvance, onNext]);

  const runCheck = useCallback(async ({ force = false } = {}) => {
    clearAutoAdvance();
    const currentRequest = ++requestIdRef.current;

    if (!force) {
      const cached = readCachedNetworkCheck();
      if (cached) {
        setAndCacheResult(cached, cached.tier === 'good'
          ? 'Connection looks good. Starting the interview...'
          : cached.tier === 'fair'
            ? 'Your connection is a bit unstable. Video may lag slightly, but audio and questions will still work.'
            : 'Your connection looks weak. We recommend switching to a stronger network or enabling audio-only mode before continuing.');
        return;
      }
    }

    setPhase('checking');
    setMessage('Checking your connection...');
    setResult(null);

    const attempt = async () => {
      try {
        return await runConnectionCheckAttempt();
      } catch {
        return null;
      }
    };

    let nextResult = await attempt();
    if (!nextResult) {
      nextResult = await attempt();
    }
    if (!nextResult) {
      nextResult = buildFallbackNetworkResult();
      nextResult.tier = 'poor';
    }

    if (currentRequest !== requestIdRef.current) return;

    const nextMessage = nextResult.tier === 'good'
      ? 'Connection looks good. Starting the interview...'
      : nextResult.tier === 'fair'
        ? 'Your connection is a bit unstable. Video may lag slightly, but audio and questions will still work.'
        : 'Your connection looks weak. We recommend switching to a stronger network or enabling audio-only mode before continuing.';
    setAndCacheResult(nextResult, nextMessage);
  }, [clearAutoAdvance, setAndCacheResult]);

  useEffect(() => {
    runCheck();
    return () => {
      clearAutoAdvance();
      requestIdRef.current += 1;
    };
  }, [clearAutoAdvance, runCheck]);

  const currentIcon = phase === 'checking'
    ? <Wifi className="iv-network-check__icon iv-network-check__icon--spin" size={26} />
    : phase === 'good'
      ? <CheckCircle2 className="iv-network-check__icon iv-network-check__icon--good" size={28} />
      : phase === 'fair'
        ? <AlertTriangle className="iv-network-check__icon iv-network-check__icon--fair" size={28} />
        : <WifiOff className="iv-network-check__icon iv-network-check__icon--poor" size={28} />;

  const currentTitle = phase === 'checking'
    ? 'Checking your connection...'
    : phase === 'good'
      ? 'Connection looks good'
      : phase === 'fair'
        ? 'Connection is a bit unstable'
        : 'Connection looks weak';

  const metricsLabel = result
    ? [
        result.downlinkMbps != null ? `${result.downlinkMbps.toFixed(1)} Mbps down` : null,
        result.uploadMbps != null ? `${result.uploadMbps.toFixed(1)} Mbps up` : null,
        result.rttMs != null ? `${result.rttMs} ms RTT` : null,
      ].filter(Boolean).join(' · ')
    : '';

  const skipNow = () => {
    clearAutoAdvance();
    onNext({ networkQualityTier: result?.tier || undefined });
  };

  return (
    <div className="iv-step iv-network-check-step">
      <h2 className="iv-step-title">Connection check</h2>
      <p className="iv-step-desc">
        We&apos;ll quickly estimate your network quality before the interview starts.
      </p>

      <div className={`iv-network-check-card iv-network-check-card--${phase}`}>
        <div className="iv-network-check-icon-wrap" aria-hidden="true">
          {currentIcon}
        </div>
        <div className="iv-network-check-copy">
          <strong>{currentTitle}</strong>
          <p>{message}</p>
          {metricsLabel ? <span>{metricsLabel}</span> : null}
        </div>

        <div className="iv-network-check-actions">
          {phase === 'good' ? null : phase === 'fair' ? (
            <button type="button" className="iv-btn iv-btn--primary" onClick={() => advance(result?.tier)}>
              Continue anyway →
            </button>
          ) : phase === 'poor' ? (
            <>
              <button type="button" className="iv-btn iv-btn--ghost" onClick={() => runCheck({ force: true })}>
                <RefreshCw size={14} />
                Retry check
              </button>
              <button type="button" className="iv-btn iv-btn--primary" onClick={() => advance(result?.tier)}>
                Continue anyway →
              </button>
            </>
          ) : null}
        </div>

        <button type="button" className="iv-network-check-skip" onClick={skipNow}>
          <SkipForward size={14} />
          Skip check
        </button>
      </div>

      {phase !== 'checking' && phase !== 'good' && (
        <div className="iv-step-actions">
          <button type="button" className="iv-btn iv-btn--ghost" onClick={() => { clearAutoAdvance(); onBack(); }}>
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
  Step 4: System Check
───────────────────────────────────────────────────────────────── */
function SystemCheckStep({ onStart, onBack, loading }) {
  const toast = useToast();
  const videoRef = useRef(null);
  const analyserRef = useRef(null);
  const animRef = useRef(null);
  const streamRef = useRef(null);
  const personCheckRafRef = useRef(null);
  const requestingPermissionsRef = useRef(false);
  const [camOk, setCamOk] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const [personOk, setPersonOk] = useState(false);
  const [personMessage, setPersonMessage] = useState('Checking camera view...');
  const [micLevel, setMicLevel] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [mediaStream, setMediaStream] = useState(null);
  const [permissionPromptOpen, setPermissionPromptOpen] = useState(true);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [permissionState, setPermissionState] = useState({ camera: 'prompt', microphone: 'prompt' });

  useEffect(() => {
    preloadFacePresenceModel().catch(() => {});
  }, []);

  const requestMediaAccess = useCallback(async () => {
    if (requestingPermissionsRef.current) return;
    requestingPermissionsRef.current = true;
    setRequestingPermissions(true);
    setError('');
    setCamOk(false);
    setMicOk(false);
    setPersonOk(false);
    setPersonMessage('Checking camera view...');

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setMediaStream(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Media devices are not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      streamRef.current = stream;
      setMediaStream(stream);
      setPermissionState({ camera: 'granted', microphone: 'granted' });
      setPermissionPromptOpen(false);
    } catch (accessError) {
      const denied = accessError?.name === 'NotAllowedError' || accessError?.name === 'SecurityError';
      const msg = denied
        ? 'Access is blocked. Choose Allow in the browser prompt, or enable camera and microphone access in this site’s browser settings.'
        : 'We could not access your camera and microphone. Check that they are connected and try again.';
      setPermissionPromptOpen(true);
      setError(msg);
      toast.error(msg);
    } finally {
      requestingPermissionsRef.current = false;
      setRequestingPermissions(false);
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    const readPermission = async (name) => {
      try {
        return (await navigator.permissions?.query({ name }))?.state || 'prompt';
      } catch {
        return 'prompt';
      }
    };

    (async () => {
      const [camera, microphone] = await Promise.all([
        readPermission('camera'),
        readPermission('microphone'),
      ]);
      if (cancelled) return;
      setPermissionState({ camera, microphone });
      if (camera === 'granted' && microphone === 'granted') {
        setPermissionPromptOpen(false);
        requestMediaAccess();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestMediaAccess]);

  useEffect(() => {
    if (!mediaStream) return undefined;
    let audioContext;
    const stream = mediaStream;
    let monitoringActive = true;
    let monitorStarted = false;
    let lastCheckAt = 0;
    let detectInFlight = false;
    let checkSeq = 0;
    const presenceStabilizer = createPersonPresenceStabilizer();

    const applyPresenceResult = (result) => {
      const { stable, message } = presenceStabilizer.update(result);
      setPersonOk(stable);
      setPersonMessage(message);
    };

    const runPersonCheck = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      detectInFlight = true;
      const seq = ++checkSeq;
      detectPersonPresence(video)
        .then((result) => {
          if (!monitoringActive || seq !== checkSeq) return;
          applyPresenceResult(result);
        })
        .finally(() => {
          if (seq === checkSeq) detectInFlight = false;
        });
    };

    const personMonitorLoop = (now) => {
      if (!monitoringActive) return;
      personCheckRafRef.current = requestAnimationFrame(personMonitorLoop);
      if (detectInFlight || now - lastCheckAt < PERSON_CHECK_INTERVAL_MS) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      lastCheckAt = now;
      runPersonCheck();
    };

    const startPersonMonitor = async () => {
      if (monitorStarted) return;
      monitorStarted = true;
      setPersonMessage('Loading face detection…');
      try {
        await preloadFacePresenceModel();
      } catch {
        setPersonMessage('Could not load face detection. Refresh the page and try again.');
        return;
      }
      setPersonMessage('Checking for face…');
      lastCheckAt = 0;
      runPersonCheck();
      personCheckRafRef.current = requestAnimationFrame(personMonitorLoop);
    };

    const setupStream = async () => {
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (track.kind === 'video') {
            setCamOk(false);
            presenceStabilizer.reset();
            setPersonOk(false);
            setPersonMessage('Camera was turned off.');
          }
          if (track.kind === 'audio') setMicOk(false);
        };
      });

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});

        const onVideoReady = () => startPersonMonitor();
        if (video.readyState >= 2 && video.videoWidth) {
          onVideoReady();
        } else {
          video.addEventListener('loadeddata', onVideoReady, { once: true });
          video.addEventListener('playing', onVideoReady, { once: true });
        }
      }
      setCamOk(stream.getVideoTracks().some((track) => track.readyState === 'live'));
      setMicOk(stream.getAudioTracks().some((track) => track.readyState === 'live'));

      try {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor && stream.getAudioTracks().length) {
          audioContext = new AudioCtor();
          const src = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
          src.connect(analyser); analyserRef.current = analyser;
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteFrequencyData(data);
            setMicLevel(data.reduce((a, b) => a + b, 0) / data.length / 128);
            animRef.current = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch {
        setMicLevel(0.4);
      }
    };

    setupStream();
    return () => {
      monitoringActive = false;
      checkSeq += 1;
      presenceStabilizer.reset();
      if (personCheckRafRef.current) cancelAnimationFrame(personCheckRafRef.current);
      audioContext?.close?.().catch?.(() => {});
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null;
    };
  }, [mediaStream]);

  useEffect(() => () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
  }, []);

  const canStart = camOk && micOk && personOk && agreed && !loading;
  const permissionStatusLabel = (status) => (
    status === 'granted' ? 'Allowed' : status === 'denied' ? 'Blocked in browser settings' : 'Permission required'
  );

  return (
    <div className="iv-step iv-step--ready iv-ready-step">
      <header className="iv-ready-head">
        <span className="iv-ready-kicker">Final check</span>
        <h2 className="iv-step-title" id="iv-ready-title">Ready to start</h2>
        <p className="iv-step-desc">
          Allow camera and microphone access, confirm you are ready, then start.
          The AI interviewer will ask each question aloud — reply when you are ready.
        </p>
      </header>
      {error && <p className="iv-error" role="alert">{error}</p>}

      {permissionPromptOpen && (
        <div
          className="iv-permission-popover"
          role="dialog"
          aria-labelledby="iv-permission-title"
          aria-describedby="iv-permission-description"
        >
          <div className="iv-permission-popover__head">
            <div className="iv-permission-popover__icon" aria-hidden="true">
              <ShieldCheck size={22} />
            </div>
            <div className="iv-permission-popover__heading">
              <span className="iv-permission-popover__eyebrow">Device check</span>
              <h3 id="iv-permission-title">Allow camera and microphone</h3>
              <p id="iv-permission-description">
                We use these only for your live interview session. Your browser will ask you to confirm access.
              </p>
            </div>
            <button
              type="button"
              className="iv-permission-popover__close"
              onClick={() => setPermissionPromptOpen(false)}
              aria-label="Close permission instructions"
            >
              <X size={17} />
            </button>
          </div>

          <div className="iv-permission-popover__devices">
            {[
              { key: 'camera', label: 'Camera', icon: Camera },
              { key: 'microphone', label: 'Microphone', icon: Mic },
            ].map(({ key, label: deviceLabel, icon: DeviceIcon }) => {
              const status = permissionState[key];
              return (
                <div key={key} className={`iv-permission-device iv-permission-device--${status}`}>
                  <DeviceIcon size={17} aria-hidden="true" />
                  <div>
                    <strong>{deviceLabel}</strong>
                    <span>{permissionStatusLabel(status)}</span>
                  </div>
                  <span className="iv-permission-device__state" aria-hidden="true">
                    {status === 'granted' ? '✓' : status === 'denied' ? '!' : '•'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="iv-permission-popover__actions">
            <button
              type="button"
              className="iv-btn iv-btn--primary"
              onClick={requestMediaAccess}
              disabled={requestingPermissions}
            >
              {requestingPermissions ? 'Waiting for permission…' : 'Allow camera & microphone'}
            </button>
            <button
              type="button"
              className="iv-permission-popover__later"
              onClick={() => setPermissionPromptOpen(false)}
              disabled={requestingPermissions}
            >
              I’ll do this later
            </button>
          </div>
          <p className="iv-permission-popover__note">
            You can change this anytime from the lock icon in your browser&apos;s address bar.
          </p>
        </div>
      )}

      <section className="iv-ready-panel" aria-labelledby="iv-ready-devices-label">
        <span className="iv-ready-panel-label" id="iv-ready-devices-label">Device check</span>
        <div className="iv-sys-check">
          <div className={`iv-cam-preview${camOk ? ' iv-cam-preview--live' : ''}`}>
            <video ref={videoRef} muted playsInline className="iv-cam-video" aria-label="Camera preview" />
            {!camOk && (
              <div className="iv-cam-fallback" aria-hidden="true">
                <Camera size={28} strokeWidth={1.5} />
                <span>Camera preview</span>
              </div>
            )}
            {camOk && (
              <span className="iv-cam-live-badge" aria-hidden="true">
                <span className="iv-cam-live-dot" />
                Live
              </span>
            )}
          </div>
          <div className="iv-check-list" role="list" aria-label="Device readiness">
            <div className={`iv-check-item${camOk ? ' iv-check-item--ok' : ''}`} role="listitem">
              <span className="iv-check-icon" aria-hidden="true">
                {camOk ? <CheckCircle2 size={15} strokeWidth={2.5} /> : '○'}
              </span>
              <div>
                <strong>Camera</strong>
                <span>{camOk ? 'Ready' : 'Permission needed'}</span>
              </div>
            </div>
            <div className={`iv-check-item${micOk ? ' iv-check-item--ok' : ''}`} role="listitem">
              <span className="iv-check-icon" aria-hidden="true">
                {micOk ? <CheckCircle2 size={15} strokeWidth={2.5} /> : '○'}
              </span>
              <div>
                <strong>Microphone</strong>
                <span>{micOk ? 'Ready' : 'Permission needed'}</span>
              </div>
            </div>
            {micOk ? (
              <div className="iv-check-meter" aria-hidden="true">
                <span className="iv-check-meter-label">Input level</span>
                <VoiceIndicator audioLevel={micLevel} isActive={micOk} label="" />
              </div>
            ) : null}
            <div className={`iv-check-item${personOk ? ' iv-check-item--ok' : ''}`} role="listitem">
              <span className="iv-check-icon" aria-hidden="true">
                {personOk ? <CheckCircle2 size={15} strokeWidth={2.5} /> : '○'}
              </span>
              <div>
                <strong>Person in frame</strong>
                <span>{personOk ? 'Detected' : 'Required'}</span>
              </div>
            </div>
            {!personOk && camOk && (
              <p className="iv-check-note">{personMessage || 'Center your face in the camera to continue.'}</p>
            )}
          </div>
        </div>
      </section>

      <section className="iv-ready-panel" aria-labelledby="iv-ready-guide-label">
        <span className="iv-ready-panel-label" id="iv-ready-guide-label">Interview guide</span>
        <div className="iv-rules-box">
        <div className="iv-rules-box-head">
          <h4>What happens next</h4>
          <p>Use these controls during the live interview.</p>
        </div>
        <div className="iv-rules-grid">
          <div className="iv-rules-card">
            <span className="iv-rules-step">1</span>
            <div>
              <strong>Start answer</strong>
              <p>Begin speaking your reply after the interviewer finishes the question.</p>
            </div>
          </div>
          <div className="iv-rules-card">
            <span className="iv-rules-step">2</span>
            <div>
              <strong>Stop &amp; submit</strong>
              <p>Finish your answer so it is saved and the next question can begin.</p>
            </div>
          </div>
          <div className="iv-rules-card">
            <span className="iv-rules-step">3</span>
            <div>
              <strong>Skip</strong>
              <p>Move on if you are stuck and want the next question instead.</p>
            </div>
          </div>
          <div className="iv-rules-card">
            <span className="iv-rules-step">4</span>
            <div>
              <strong>Replay</strong>
              <p>Hear the current question again if you missed any part of it.</p>
            </div>
          </div>
        </div>
        <p className="iv-rules-footnote">
          Stay on this tab for the best experience. Starting enters fullscreen — leaving counts toward integrity warnings.
          When time ends or you click End, your report opens automatically.
        </p>
        </div>
      </section>

      <footer className="iv-ready-footer">
        <label className="iv-agree-label">
          <input
            type="checkbox"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
            aria-describedby="iv-ready-title"
          />
          <span>I am ready to begin</span>
        </label>

        <div className="iv-step-actions iv-ready-actions">
          <button type="button" className="iv-btn iv-btn--ghost" onClick={onBack}>← Back</button>
          <button
            type="button"
            className="iv-btn iv-btn--primary"
            disabled={!canStart}
            onClick={() => {
              if (!canStart) {
                if (camOk && micOk && agreed && !personOk) {
                  toast.warning('Center your face in the camera before starting.');
                }
                return;
              }
              // requestFullscreen must run synchronously in this click handler (user gesture).
              if (supportsFullscreen() && !isAppFullscreen()) {
                requestAppFullscreen()
                  .then(() => console.info('[fullscreen] entered (start_interview)'))
                  .catch((error) => {
                    const message = formatFullscreenError(error);
                    console.warn('[fullscreen] start_interview failed:', message, error);
                    toast.warning(`Fullscreen could not start: ${message}`);
                  });
              }
              onStart();
            }}
            aria-disabled={!canStart}
          >
            {loading
              ? <span className="iv-btn-loading"><span className="iv-btn-spinner" />Creating interview</span>
              : 'Start Interview'}
          </button>
        </div>
      </footer>
      {loading && <InterviewLoader title="Creating your interview" message="Generating tailored questions and preparing the interviewer." />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Live Session — camera + audio
───────────────────────────────────────────────────────────────── */
function LiveSession({ interview, persona: personaProp, onComplete, onInterviewUpdate }) {
  const toast = useToast();
  const { user } = useContext(AuthContext);
  const persona =
    personaProp
    || PERSONAS.find((p) => p.id === interview?.personaId)
    || PERSONAS[0];
  const [tabConflict, setTabConflict] = useState(false);
  const [questions, setQuestions] = useState(interview.questions || []);
  const [currentIdx, setCurrentIdx] = useState(interview.currentQuestionIndex || 0);
  const [totalQuestions, setTotalQuestions] = useState(interview.totalPlannedQuestions || interview.questions?.length || 0);
  const [transcript, setTranscript] = useState([]);
  const [isSpeaking, setIsSpeaking]   = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel]   = useState(0);
  const [timer, setTimer]             = useState(interview.duration * 60 || 1800);
  const [interimText, setInterimText] = useState('');
  const [ending, setEnding]           = useState(false);
  const [isProcessingAnswer, setIsProcessingAnswer] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [personDetected, setPersonDetected] = useState(false);
  const [proctorCameraStatus, setProctorCameraStatus] = useState('checking');
  const [voiceDiagnostics, setVoiceDiagnostics] = useState(null);
  const [latestEvaluation, setLatestEvaluation] = useState(null);
  const [liveScores, setLiveScores] = useState(interview.liveScores || {});
  const [codingLanguage, setCodingLanguage] = useState('python');
  const [codingSource, setCodingSource] = useState('');
  const codingSourceRef = useRef('');
  const [designNotes, setDesignNotes] = useState('');
  const [integrityViolationCount, setIntegrityViolationCount] = useState(
    () => (interview.violations || []).filter((item) => ['fullscreen_exit', 'tab_switch'].includes(item.type)).length,
  );
  const [integrityWarning, setIntegrityWarning] = useState('');
  const [integrityEndMessage, setIntegrityEndMessage] = useState('');
  const [clipboardNotice, setClipboardNotice] = useState('');
  const [faceWarning, setFaceWarning] = useState('');
  const [hasNewTranscript, setHasNewTranscript] = useState(false);
  const [awaitingAnswerStart, setAwaitingAnswerStart] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);

  const candidateName = (
    interview?.speakerName
    || interview?.accountOwnerName
    || user?.name
    || 'You'
  ).trim();

  const videoRef        = useRef(null);
  const liveMediaStreamRef = useRef(null);
  const recognitionRef  = useRef(null);
  const answerRecorderRef = useRef(null);
  const answerStreamRef = useRef(null);
  const answerChunksRef = useRef([]);
  const answerCaptureModeRef = useRef(null);
  const animRef         = useRef(null);
  const animFrameRef    = useRef(null);
  const timerRef        = useRef(null);
  const ttsSourceRef    = useRef(null);
  const autoSubmittedRef    = useRef(false);
  const finishingRef        = useRef(false);
  const completeRequestedRef  = useRef(false);
  const sessionClosedRef    = useRef(false);
  const transcriptRef       = useRef([]);
  const transcriptScrollRef = useRef(null);
  const transcriptNearBottomRef = useRef(true);
  const interimTextRef      = useRef('');
  const currentAnswerPartsRef = useRef([]);
  const eventCooldownRef = useRef({});
  const fullscreenRecoveryTimerRef = useRef(null);
  const focusRecoveryTimerRef = useRef(null);
  const keepSpeechRecognitionAliveRef = useRef(false);
  const isSubmittingAnswerRef = useRef(false);
  const lastCameraEventAtRef = useRef(0);
  const lastAnswerActivityAtRef = useRef(Date.now());
  const silencePromptedRef = useRef(false);
  const openingStartedRef = useRef(false);
  const closingSpokenRef = useRef(false);
  const speakTextRef = useRef(async () => false);
  const integrityViolationCountRef = useRef(integrityViolationCount);
  const integrityEventAtRef = useRef(0);
  const integrityTerminationRef = useRef(null);
  const faceIncidentRef = useRef(null);

  // Keep transcriptRef in sync
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { interimTextRef.current = interimText; }, [interimText]);

  const isTranscriptNearBottom = useCallback((element) => {
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 72;
  }, []);

  const handleTranscriptScroll = useCallback((event) => {
    const nearBottom = isTranscriptNearBottom(event.currentTarget);
    transcriptNearBottomRef.current = nearBottom;
    if (nearBottom) setHasNewTranscript(false);
  }, [isTranscriptNearBottom]);

  const scrollTranscriptToLatest = useCallback((behavior = 'smooth') => {
    const element = transcriptScrollRef.current;
    if (!element) return;
    transcriptNearBottomRef.current = true;
    setHasNewTranscript(false);
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const element = transcriptScrollRef.current;
    if (!element) return undefined;

    const keepLatestVisible = () => {
      if (transcriptNearBottomRef.current || isTranscriptNearBottom(element)) {
        transcriptNearBottomRef.current = true;
        element.scrollTop = element.scrollHeight;
        setHasNewTranscript(false);
      } else {
        setHasNewTranscript(true);
      }
    };

    const frame = requestAnimationFrame(keepLatestVisible);
    return () => cancelAnimationFrame(frame);
  }, [currentIdx, interimText, isTranscriptNearBottom, transcript.length]);

  useEffect(() => {
    currentAnswerPartsRef.current = [];
    lastAnswerActivityAtRef.current = Date.now();
    silencePromptedRef.current = false;
    setCodingSource('');
    codingSourceRef.current = '';
    setDesignNotes('');
  }, [currentIdx]);

  const getAnswerSinceLastQuestionFromRefs = useCallback(() => {
    const curr = transcriptRef.current;
    const lastInterviewerIdx = [...curr].map((m, i) => m.role === 'interviewer' ? i : -1).filter(i => i >= 0).pop() ?? -1;
    const transcriptText = curr
      .slice(lastInterviewerIdx + 1)
      .filter(m => m.role === 'candidate')
      .map(m => m.text)
      .join(' ')
      .trim();
    const bufferedText = currentAnswerPartsRef.current.join(' ').trim();
    const finalText = bufferedText || transcriptText;
    const interim = answerCaptureModeRef.current === 'speech' ? interimTextRef.current.trim() : '';
    if (interim && finalText.toLowerCase().endsWith(interim.toLowerCase())) return finalText;
    return [finalText, interim].filter(Boolean).join(' ').trim();
  }, []);

  useEffect(() => {
    const currentQuestion = questions[currentIdx];
    if (isCodingQuestion(currentQuestion)) {
      const detected = detectLanguageFromQuestion(currentQuestion);
      const starter = languageStarter(detected);
      setCodingLanguage(detected);
      setCodingSource(starter);
      codingSourceRef.current = starter;
      setDesignNotes('');
      return;
    }
    setCodingSource('');
    codingSourceRef.current = '';
    if (!isDesignQuestion(currentQuestion)) setDesignNotes('');
  }, [currentIdx, questions]);

  /* ── Stop listening ─────────────────────────────── */
  const stopListening = useCallback(() => {
    keepSpeechRecognitionAliveRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) { try { rec.onend = null; rec.stop(); } catch {} }
    if (answerRecorderRef.current?.state === 'recording') {
      try { answerRecorderRef.current.requestData?.(); } catch {}
      try { answerRecorderRef.current.stop(); } catch {}
    }
    answerRecorderRef.current = null;
    if (answerStreamRef.current) {
      answerStreamRef.current.getTracks().forEach(track => track.stop());
      answerStreamRef.current = null;
    }
    answerCaptureModeRef.current = null;
    setIsListening(false);
    setInterimText('');
  }, []);

  const stopLiveMedia = useCallback(() => {
    const stream = liveMediaStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      liveMediaStreamRef.current = null;
    }
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch {}
    }
    setCameraReady(false);
    setPersonDetected(false);
    setProctorCameraStatus('off');
  }, []);

  /* ── Stop TTS ───────────────────────────────────── */
  const stopSpeech = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    try { window.speechSynthesis?.cancel(); } catch {}
    stopTtsAudio(ttsSourceRef.current);
    ttsSourceRef.current = null;
    setIsSpeaking(false);
    setAudioLevel(0);
  }, []);

  // B06: block a second tab from racing the same live interview.
  useEffect(() => {
    if (!interview?._id) return undefined;
    const lockKey = `fluentai_live_lock_${interview._id}`;
    const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const readLock = () => {
      try { return JSON.parse(localStorage.getItem(lockKey) || 'null'); } catch { return null; }
    };
    const writeLock = () => {
      try { localStorage.setItem(lockKey, JSON.stringify({ tabId, at: Date.now() })); } catch {}
    };
    const existing = readLock();
    if (existing?.tabId && existing.tabId !== tabId && Date.now() - (existing.at || 0) < 8_000) {
      setTabConflict(true);
      sessionClosedRef.current = true;
      return undefined;
    }
    writeLock();
    const heartbeat = setInterval(writeLock, 2_000);
    const onStorage = (event) => {
      if (event.key !== lockKey || !event.newValue) return;
      try {
        const next = JSON.parse(event.newValue);
        if (next.tabId && next.tabId !== tabId) {
          setTabConflict(true);
          sessionClosedRef.current = true;
          stopListening();
          stopSpeech();
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('storage', onStorage);
      const current = readLock();
      if (current?.tabId === tabId) {
        try { localStorage.removeItem(lockKey); } catch {}
      }
    };
  }, [interview?._id, stopListening, stopSpeech]);

  const terminateForIntegrity = useCallback(async (reasonType) => {
    if (finishingRef.current || sessionClosedRef.current) return;
    finishingRef.current = true;
    autoSubmittedRef.current = true;
    setEnding(true);

    const currentQuestion = questions[currentIdx]?.question;
    const pendingAnswer = getAnswerSinceLastQuestionFromRefs();
    const isCoding = isCodingQuestion(questions[currentIdx]);
    const isDesign = isDesignQuestion(questions[currentIdx]);
    const liveCode = codingSourceRef.current || codingSource;
    const codeBlock = isCoding && liveCode.trim() && !isLanguageStarter(liveCode)
      ? liveCode.trim()
      : '';
    const designBlock = isDesign && designNotes.trim() ? designNotes.trim() : '';
    const answerToSave = [
      pendingAnswer,
      codeBlock ? `Submitted code (${codingLanguage}):\n${codeBlock}` : '',
      designBlock ? `Design whiteboard notes:\n${designBlock}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      if (answerToSave && currentQuestion && !questions[currentIdx]?.userAnswer) {
        try {
          await interviewAPI.submitAnswer(interview._id, currentQuestion, answerToSave);
        } catch {
          // The termination record is still persisted even if the last evaluation cannot finish.
        }
      }

      stopListening();
      stopSpeech();
      stopLiveMedia();
      sessionClosedRef.current = true;

      await interviewAPI.terminate(interview._id, reasonType, currentIdx);
      setEnding(false);
      setIntegrityEndMessage(
        'This interview ended early because the maximum number of fullscreen or tab-switch warnings was reached. Your saved responses are available in your report.',
      );
      try {
        localStorage.removeItem(ACTIVE_INTERVIEW_KEY);
        localStorage.removeItem(ACTIVE_PERSONA_KEY);
        localStorage.setItem(OPEN_REPORT_KEY, interview._id);
      } catch {}
      if (isAppFullscreen()) {
        try { await exitAppFullscreen(); } catch {}
      }
      window.setTimeout(() => onComplete(interview._id), 1800);
    } catch (error) {
      setEnding(false);
      toast.error(error?.response?.data?.message || 'The interview was stopped, but its integrity record could not be confirmed. Please retry from your interview history.');
      finishingRef.current = false;
      autoSubmittedRef.current = false;
      sessionClosedRef.current = false;
    }
  }, [
    codingLanguage,
    codingSource,
    currentIdx,
    designNotes,
    getAnswerSinceLastQuestionFromRefs,
    interview._id,
    onComplete,
    questions,
    stopLiveMedia,
    stopListening,
    stopSpeech,
    toast,
  ]);

  useEffect(() => {
    integrityTerminationRef.current = terminateForIntegrity;
    return () => {
      if (integrityTerminationRef.current === terminateForIntegrity) integrityTerminationRef.current = null;
    };
  }, [terminateForIntegrity]);

  /* ── Finish session ─────────────────────────────── */
  const finishSession = useCallback(async ({ speakClosing = true } = {}) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    autoSubmittedRef.current = true;
    setEnding(true);
    clearInterval(timerRef.current);

    const END_HARD_TIMEOUT_MS = 60_000;
    const withTimeout = (promise, ms) =>
      Promise.race([
        promise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('END_TIMEOUT')), ms);
        }),
      ]);

    let completeError = '';
    try {
      await withTimeout((async () => {
        const pendingAnswer = getAnswerSinceLastQuestionFromRefs();
        const currentQuestion = questions[currentIdx]?.question;
        if (pendingAnswer && currentQuestion && !questions[currentIdx]?.userAnswer) {
          try {
            await interviewAPI.submitAnswer(interview._id, currentQuestion, pendingAnswer);
          } catch {}
        }
        stopListening();

        if (speakClosing && !closingSpokenRef.current) {
          closingSpokenRef.current = true;
          const closing =
            persona?.closing
            || 'Thank you for the interview. Review your report for strengths and one area to practice next.';
          setTranscript(prev => [...prev, { role: 'interviewer', text: closing }]);
          // Cap spoken wrap so End never stalls on TTS.
          await Promise.race([
            speakTextRef.current(closing),
            new Promise((resolve) => setTimeout(resolve, 12_000)),
          ]);
        }

        sessionClosedRef.current = true;
        stopSpeech();
        stopListening();
        stopLiveMedia();
        if (!completeRequestedRef.current) {
          completeRequestedRef.current = true;
          try {
            await interviewAPI.completeInterview(interview._id);
          } catch (err) {
            completeError = err?.response?.data?.message || 'Could not finalize the interview report.';
          }
        }
      })(), END_HARD_TIMEOUT_MS);
    } catch (err) {
      sessionClosedRef.current = true;
      stopSpeech();
      stopListening();
      stopLiveMedia();
      if (!completeError) {
        completeError =
          err?.message === 'END_TIMEOUT'
            ? 'Interview ended with a timeout. Opening the report with whatever was captured.'
            : (err?.response?.data?.message || 'Interview ended with a partial save.');
      }
      if (!completeRequestedRef.current) {
        completeRequestedRef.current = true;
        try {
          await interviewAPI.completeInterview(interview._id);
        } catch {}
      }
    }

    try {
      localStorage.removeItem(ACTIVE_INTERVIEW_KEY);
      localStorage.removeItem(ACTIVE_PERSONA_KEY);
      localStorage.setItem(OPEN_REPORT_KEY, interview._id);
    } catch {}
    if (isAppFullscreen()) { try { await exitAppFullscreen(); } catch {} }
    if (completeError) {
      toast.warning(completeError);
    } else {
      toast.success('Interview complete. Opening your report…');
    }
    onComplete(interview._id, completeError);
  }, [
    currentIdx,
    getAnswerSinceLastQuestionFromRefs,
    interview._id,
    onComplete,
    persona?.closing,
    questions,
    stopListening,
    stopLiveMedia,
    stopSpeech,
    toast,
  ]);

  /* ── Quiet session event log (no warning UI) ─────── */
  const logSessionEvent = useCallback(async (type, description) => {
    if (sessionClosedRef.current || autoSubmittedRef.current) return;
    const now = Date.now();
    if (now - (eventCooldownRef.current[type] ?? 0) < VIOLATION_COOLDOWN_MS) return;
    eventCooldownRef.current[type] = now;
    try { await interviewAPI.logViolation(interview._id, type, description); } catch {}
  }, [interview._id]);

  const persistFaceIncident = useCallback(async (incident) => {
    if (!incident) return;
    try {
      await interviewAPI.logFaceIncident(interview._id, {
        type: incident.type,
        startedAt: new Date(incident.startedAt).toISOString(),
        endedAt: new Date(incident.endedAt || Date.now()).toISOString(),
        durationMs: Math.max(0, Number(incident.durationMs) || 0),
        description: incident.type === 'multiple_faces'
          ? 'Multiple faces were visible in the camera frame.'
          : 'No face was visible in the camera frame.',
      });
    } catch {
      // Face incidents are best-effort telemetry and never interrupt the interview.
    }
  }, [interview._id]);

  const logIntegrityViolation = useCallback(async (type, description) => {
    if (sessionClosedRef.current || autoSubmittedRef.current) return;
    const now = Date.now();
    if (now - integrityEventAtRef.current < 1500) return;
    integrityEventAtRef.current = now;

    const localCount = integrityViolationCountRef.current + 1;
    integrityViolationCountRef.current = localCount;
    setIntegrityViolationCount(localCount);
    const remaining = Math.max(0, 3 - localCount);
    const warning = remaining > 0
      ? `Warning: leaving fullscreen or switching tabs will end your interview. ${remaining} warning${remaining === 1 ? '' : 's'} remaining.`
      : 'Maximum integrity warnings reached. Ending your interview now.';
    setIntegrityWarning(warning);
    toast.warning(warning);

    try {
      const response = await interviewAPI.logViolation(interview._id, type, description);
      const persistedViolations = response.data?.violations || [];
      const persistedCount = persistedViolations.filter((item) => ['fullscreen_exit', 'tab_switch'].includes(item.type)).length;
      const count = Math.max(localCount, persistedCount);
      integrityViolationCountRef.current = count;
      setIntegrityViolationCount(count);
      if (count >= 3) integrityTerminationRef.current?.(type);
    } catch {
      if (localCount >= 3) integrityTerminationRef.current?.(type);
      else toast.error('Could not sync this integrity warning to the server. We will retry on the next event.');
    }
  }, [interview._id, toast]);

  const handleEnterFullscreen = useCallback(() => {
    void enterInterviewFullscreen({ logLabel: 'manual_prompt', toast }).then((result) => {
      if (result.ok) setShowFullscreenPrompt(false);
    });
  }, [toast]);

  useEffect(() => {
    if (!supportsFullscreen()) return undefined;
    const syncPrompt = () => {
      setShowFullscreenPrompt(!isAppFullscreen());
    };
    syncPrompt();
    document.addEventListener('fullscreenchange', syncPrompt);
    document.addEventListener('webkitfullscreenchange', syncPrompt);
    return () => {
      document.removeEventListener('fullscreenchange', syncPrompt);
      document.removeEventListener('webkitfullscreenchange', syncPrompt);
    };
  }, []);

  const handleClipboardAttempt = useCallback((type = 'clipboard') => {
    const message = 'Copy, cut, and paste are disabled during the interview.';
    setClipboardNotice(message);
    toast.warning(message);
    logSessionEvent(`${type}_attempt`, `Blocked ${type} attempt in a student answer field`);
    window.setTimeout(() => setClipboardNotice(''), 3200);
  }, [logSessionEvent, toast]);

  /* ── Soft session guards (no warning popups) ─────── */
  useEffect(() => {
    // TEMPORARILY DISABLED FOR LOAD TESTING:
    // fullscreen, tab-switch, and window-focus listeners are commented below.
    // Uncomment those listener lines after load testing is complete.
    const fullscreenPreferred = supportsFullscreen();

    const onFSChange = () => {
      if (fullscreenPreferred && !isAppFullscreen() && !autoSubmittedRef.current) {
        clearTimeout(fullscreenRecoveryTimerRef.current);
        fullscreenRecoveryTimerRef.current = setTimeout(() => {
          if (sessionClosedRef.current || autoSubmittedRef.current) return;
          if (isAppFullscreen()) return;
          logIntegrityViolation('fullscreen_exit', 'Exited fullscreen mode');
        }, FULLSCREEN_RECHECK_MS);
      }
    };

    const noteSoftTabSwitch = (description) => {
      logIntegrityViolation('tab_switch', description);
    };

    const onVisibility = () => {
      if (!document.hidden || autoSubmittedRef.current) return;
      setTimeout(() => {
        if (document.hidden && !sessionClosedRef.current && !autoSubmittedRef.current) {
          noteSoftTabSwitch('Switched to another tab or minimized window');
        }
      }, FOCUS_RECHECK_MS);
    };

    const onBlur = () => {
      if (autoSubmittedRef.current) return;
      clearTimeout(focusRecoveryTimerRef.current);
      focusRecoveryTimerRef.current = setTimeout(() => {
        if ((!document.hasFocus?.() || document.hidden) && !sessionClosedRef.current && !autoSubmittedRef.current) {
          noteSoftTabSwitch('Window lost focus');
        }
      }, FOCUS_RECHECK_MS);
    };

    const onKeyDown = e => {
      if (autoSubmittedRef.current) return;
      if (isClipboardShortcut(e)) return;
      if (isBlockedInterviewShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        logSessionEvent('blocked_shortcut', `Blocked keyboard shortcut: ${e.key}`);
      }
    };

    // if (fullscreenPreferred) document.addEventListener('fullscreenchange', onFSChange);
    // if (fullscreenPreferred) document.addEventListener('webkitfullscreenchange', onFSChange);
    // document.addEventListener('visibilitychange', onVisibility);
    // window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      // if (fullscreenPreferred) document.removeEventListener('fullscreenchange', onFSChange);
      // if (fullscreenPreferred) document.removeEventListener('webkitfullscreenchange', onFSChange);
      // document.removeEventListener('visibilitychange', onVisibility);
      // window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown, true);
      clearTimeout(fullscreenRecoveryTimerRef.current);
      clearTimeout(focusRecoveryTimerRef.current);
      if (isAppFullscreen()) exitAppFullscreen().catch(() => {});
    };
  }, [logIntegrityViolation, logSessionEvent, toast]);

  /* ── Camera PiP + mic analyser ──────────────────── */
  useEffect(() => {
    let cancelled = false;
    let stream;
    let personCheck;
    let audioContext;
    const reportCameraEvent = (type, description, { immediate = false } = {}) => {
      const now = Date.now();
      if (!immediate && now - lastCameraEventAtRef.current < PERSON_MISSING_GRACE_MS) return;
      lastCameraEventAtRef.current = now;
      logSessionEvent(type, description);
    };

    const flushFaceIncident = () => {
      const incident = faceIncidentRef.current;
      if (!incident || incident.logged) return;
      const endedAt = Date.now();
      const durationMs = endedAt - incident.startedAt;
      if (durationMs >= PERSON_MISSING_GRACE_MS) {
        incident.logged = true;
        persistFaceIncident({ ...incident, endedAt, durationMs });
      }
      faceIncidentRef.current = null;
      setFaceWarning('');
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled || sessionClosedRef.current || autoSubmittedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        liveMediaStreamRef.current = stream;
        stream.getVideoTracks().forEach((track) => {
          track.onended = () => {
            setCameraReady(false);
            setPersonDetected(false);
            reportCameraEvent('camera_off', 'Camera was turned off during the interview');
          };
          track.onmute = () => {
            setCameraReady(false);
            setPersonDetected(false);
            reportCameraEvent('camera_muted', 'Camera feed was interrupted during the interview');
          };
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);

        const checkPerson = async () => {
          if (sessionClosedRef.current || autoSubmittedRef.current) return;
          const videoTrack = stream?.getVideoTracks()[0];
          if (!videoTrack || videoTrack.readyState !== 'live' || videoTrack.muted) {
            setCameraReady(false);
            setPersonDetected(false);
            setProctorCameraStatus('off');
            reportCameraEvent('camera_off', 'Camera must stay on during the interview');
            return;
          }

          const result = await detectPersonPresence(videoRef.current);
          const detected = result.detected;
          setPersonDetected(detected);
          setProctorCameraStatus(detected ? 'ok' : 'missing');
          if (detected) {
            flushFaceIncident();
            return;
          }

          const now = Date.now();
          const issueType = result.issueType || 'no_face';
          if (!faceIncidentRef.current || faceIncidentRef.current.type !== issueType) {
            flushFaceIncident();
            faceIncidentRef.current = { type: issueType, startedAt: now, logged: false };
          }
          const durationMs = now - faceIncidentRef.current.startedAt;
          if (durationMs >= PERSON_MISSING_GRACE_MS) {
            setFaceWarning(result.reason || (issueType === 'multiple_faces'
              ? 'Multiple faces detected. Please make sure you are the only person in frame.'
              : 'We cannot see your face. Please adjust your lighting or camera position.'));
          }
        };
        personCheck = setInterval(checkPerson, PERSON_CHECK_INTERVAL_MS);
        await checkPerson();

        try {
          const AudioCtor = window.AudioContext || window.webkitAudioContext;
          if (AudioCtor) {
            audioContext = new AudioCtor();
            const src = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser(); analyser.fftSize = 128;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              analyser.getByteFrequencyData(data);
              setAudioLevel(data.reduce((a, b) => a + b, 0) / data.length / 128);
              animRef.current = requestAnimationFrame(tick);
            };
            tick();
          }
        } catch {
          setAudioLevel(0.4);
        }
      } catch {
        setCameraReady(false);
        setPersonDetected(false);
        reportCameraEvent('camera_unavailable', 'Camera and microphone access are required during the interview', { immediate: true });
      }
    })();
    return () => {
      cancelled = true;
      flushFaceIncident();
      clearInterval(personCheck);
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (liveMediaStreamRef.current === stream) liveMediaStreamRef.current = null;
      if (videoRef.current) {
        try { videoRef.current.srcObject = null; } catch {}
      }
      audioContext?.close?.().catch?.(() => {});
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [logSessionEvent, persistFaceIncident]);

  /* ── Timer ──────────────────────────────────────── */
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          if (!autoSubmittedRef.current) {
            autoSubmittedRef.current = true;
            setTranscript((messages) => [
              ...messages,
              { role: 'system', text: "Time's up. Ending the interview and preparing your report." },
            ]);
            toast.warning("Time's up. Ending the interview and preparing your report.");
            finishSession({ speakClosing: true });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [finishSession, toast]);

  /* ── Unlock audio autoplay on mount ─────────────── */
  useEffect(() => {
    try {
      const a = new Audio();
      a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      a.volume = 0;
      a.play().catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    // Reset on mount so React Strict Mode cleanup does not leave the session permanently closed.
    sessionClosedRef.current = false;
    const releaseInterviewMedia = () => {
      sessionClosedRef.current = true;
      stopListening();
      stopLiveMedia();
      stopSpeech();
    };
    window.addEventListener('pagehide', releaseInterviewMedia);
    window.addEventListener('beforeunload', releaseInterviewMedia);
    return () => {
      sessionClosedRef.current = true;
      window.removeEventListener('pagehide', releaseInterviewMedia);
      window.removeEventListener('beforeunload', releaseInterviewMedia);
      releaseInterviewMedia();
    };
  }, [stopListening, stopLiveMedia, stopSpeech]);

  /* ── TTS: play interviewer audio blob ───────────── */
  const playSpeechBlob = useCallback(async (blob) => {
    if (sessionClosedRef.current) return false;
    stopTtsAudio(ttsSourceRef.current);
    ttsSourceRef.current = null;

    try {
      const audio = await playAudioBlob(blob, {
        settings: INTERVIEW_TTS_PLAYBACK_SETTINGS,
        diagnosticsLabel: 'interview-question',
        onDiagnostics: setVoiceDiagnostics,
        onPlay: (audioElement) => {
          ttsSourceRef.current = audioElement;
          setIsSpeaking(true);
          const tick = () => {
            if (!ttsSourceRef.current || ttsSourceRef.current.paused) return;
            setAudioLevel(0.2 + Math.random() * 0.6);
            animFrameRef.current = requestAnimationFrame(tick);
          };
          tick();
        },
        onEnded: () => {
          cancelAnimationFrame(animFrameRef.current);
          setAudioLevel(0);
          setIsSpeaking(false);
          ttsSourceRef.current = null;
        },
        onError: () => {
          cancelAnimationFrame(animFrameRef.current);
          setIsSpeaking(false);
          ttsSourceRef.current = null;
        },
      });
      ttsSourceRef.current = audio;
      return true;
    } catch {
      cancelAnimationFrame(animFrameRef.current);
      setIsSpeaking(false);
      ttsSourceRef.current = null;
      return false;
    }
  }, []);

  /* ── Speak question ─────────────────────────────── */
  const speakQuestion = useCallback(async (questionText, addToTranscript = true) => {
    if (sessionClosedRef.current) return;
    setAwaitingAnswerStart(false);
    if (addToTranscript) {
      setTranscript(prev => {
        const last = [...prev].reverse().find(m => m.role === 'interviewer');
        if (last?.text === questionText) return prev;
        return [...prev, { role: 'interviewer', text: questionText }];
      });
    }
    try {
      const voiceStyle = persona?.voiceStyle || 'default';
      const res = await interviewAPI.speak(interview._id, questionText, voiceStyle, {
        pace: persona?.speechPace || 1,
        personaId: persona?.id,
      });
      if (sessionClosedRef.current) return;
      const played = await playSpeechBlob(res.data);
      if (!played && !sessionClosedRef.current) {
        const msg = 'The selected interviewer voice could not be played. The text question is still available below.';
        setTranscript(prev => [...prev, { role: 'system', text: msg }]);
        toast.error(msg);
      }
    } catch (error) {
      if (sessionClosedRef.current) return;
      const message = await ttsErrorMessage(error, 'The selected interviewer voice is unavailable. Continue with the text question while the voice issue is reported.');
      setTranscript(prev => [...prev, { role: 'system', text: message }]);
      toast.error(message);
    } finally {
      if (!sessionClosedRef.current) {
        setAwaitingAnswerStart(true);
      }
    }
  }, [interview._id, persona, playSpeechBlob, toast]);

  useEffect(() => {
    speakTextRef.current = async (text) => {
      if (!text || sessionClosedRef.current) return false;
      try {
        const voiceStyle = persona?.voiceStyle || 'default';
        const res = await interviewAPI.speak(interview._id, text, voiceStyle, {
          pace: persona?.speechPace || 1,
          personaId: persona?.id,
        });
        const played = await playSpeechBlob(res.data);
        if (played) return true;
        if (!sessionClosedRef.current) {
          const message = 'The selected interviewer voice could not be played.';
          setTranscript(prev => [...prev, { role: 'system', text: message }]);
          toast.error(message);
        }
        return false;
      } catch (error) {
        if (!sessionClosedRef.current) {
          const message = await ttsErrorMessage(error, 'The selected interviewer voice is unavailable.');
          setTranscript(prev => [...prev, { role: 'system', text: message }]);
          toast.error(message);
        }
        return false;
      }
    };
  }, [interview._id, persona, playSpeechBlob, toast]);

  /* ── Opening: wait for mic/cam, persona intro, then first unanswered Q ── */
  useEffect(() => {
    if (!cameraReady || openingStartedRef.current || sessionClosedRef.current) return;
    openingStartedRef.current = true;

    const runOpening = async () => {
      const idx = Number.isInteger(interview.currentQuestionIndex) ? interview.currentQuestionIndex : 0;
      const active = questions[idx];
      const isFreshStart = idx === 0 && !active?.userAnswer;

      if (isFreshStart && persona?.intro) {
        setTranscript(prev => [...prev, { role: 'interviewer', text: persona.intro }]);
        await speakTextRef.current(persona.intro);
      }

      if (sessionClosedRef.current) return;
      if (active?.question && !active.userAnswer) {
        await speakQuestion(active.question);
      }
    };

    runOpening();
  }, [cameraReady, interview.currentQuestionIndex, persona?.intro, questions, speakQuestion]);

  /* ── Speech recognition ─────────────────────────── */
  const addCandidateTranscript = useCallback((text) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    // Keep only recent spoken chunks in memory for long 45m sessions (J10).
    currentAnswerPartsRef.current = [...currentAnswerPartsRef.current, clean].slice(-40);
    lastAnswerActivityAtRef.current = Date.now();
    silencePromptedRef.current = false;
    setTranscript(prev => [...prev, { role: 'candidate', text: clean }].slice(-MAX_LIVE_TRANSCRIPT_MESSAGES));
  }, []);

  const getAnswerSinceLastQuestion = useCallback(() => {
    return getAnswerSinceLastQuestionFromRefs();
  }, [getAnswerSinceLastQuestionFromRefs]);

  useEffect(() => {
    if (!isListening || ending || isProcessingAnswer) return undefined;

    const silenceTimer = setInterval(() => {
      if (silencePromptedRef.current) return;
      if (Date.now() - lastAnswerActivityAtRef.current < ANSWER_SILENCE_PROMPT_MS) return;

      silencePromptedRef.current = true;
      const hasAnswer = Boolean(getAnswerSinceLastQuestion() || interimTextRef.current.trim());
      if (!hasAnswer) {
        const msg = 'No answer was detected for one minute. Moving to the next question.';
        setTranscript(prev => [...prev, {
          role: 'system',
          text: msg,
        }]);
        toast.warning(msg);
        stopListening();
        submitAnswer('', true);
        return;
      }

      const tip = 'Take your time. When you finish your answer, click Stop & submit.';
      setTranscript(prev => [...prev, {
        role: 'system',
        text: tip,
      }]);
      toast.info(tip);
    }, 1000);

    return () => clearInterval(silenceTimer);
  }, [ending, getAnswerSinceLastQuestion, isListening, isProcessingAnswer, toast]);

  const startRecordedAnswer = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      const msg = 'Microphone recording is not supported in this browser.';
      setTranscript(prev => [...prev, { role: 'system', text: msg }]);
      toast.error(msg);
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      const { recorder, mimeType } = createAudioRecorder(stream);
      answerChunksRef.current = [];
      answerStreamRef.current = stream;
      answerRecorderRef.current = recorder;
      answerCaptureModeRef.current = 'recording';
      keepSpeechRecognitionAliveRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) answerChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (answerStreamRef.current) {
          answerStreamRef.current.getTracks().forEach(track => track.stop());
          answerStreamRef.current = null;
        }
      };

      recorder.start(250);
      lastAnswerActivityAtRef.current = Date.now();
      silencePromptedRef.current = false;
      setIsListening(true);
      setInterimText('Recording your answer...');
      return true;
    } catch {
      const msg = 'Could not access microphone. Please allow microphone permission and try again.';
      setTranscript(prev => [...prev, { role: 'system', text: msg }]);
      toast.error(msg);
      setIsListening(false);
      setInterimText('');
      return false;
    }
  };

  const startListening = ({ allowRecordingFallback = true, preferRecording = false } = {}) => {
    if (sessionClosedRef.current || ending) return;
    setAwaitingAnswerStart(false);
    stopSpeech();
    if (preferRecording) {
      startRecordedAnswer();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      if (allowRecordingFallback) {
        const msg = 'Live speech recognition is limited in this browser (common on Firefox/Safari). Recording your answer and transcribing on the server instead.';
        setTranscript(prev => [...prev, {
          role: 'system',
          text: msg,
        }]);
        toast.info(msg);
        startRecordedAnswer();
      } else {
        const msg = 'Speech recognition is unavailable in this browser. Use Chrome, or enable microphone recording fallback.';
        setTranscript(prev => [...prev, {
          role: 'system',
          text: msg,
        }]);
        toast.error(msg);
      }
      return;
    }
    const rec = new SR();
    // en-IN improves recognition of Indian names/universities vs default en-US
    // (e.g. "Vignan" is often misheard as "Nancy" under en-US).
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (interim || final) lastAnswerActivityAtRef.current = Date.now();
      setInterimText(normalizeSpeechTranscript(interim, interview.resumeText));
      if (final) {
        setInterimText('');
        addCandidateTranscript(normalizeSpeechTranscript(final, interview.resumeText));
      }
    };
    rec.onend = () => {
      if (sessionClosedRef.current || !keepSpeechRecognitionAliveRef.current || answerCaptureModeRef.current !== 'speech') {
        if (!sessionClosedRef.current) setIsListening(false);
        return;
      }

      setTimeout(() => {
        if (sessionClosedRef.current || !keepSpeechRecognitionAliveRef.current || answerCaptureModeRef.current !== 'speech') return;
        try {
          rec.start();
          setIsListening(true);
        } catch {
          setIsListening(false);
        }
      }, 250);
    };
    rec.onerror = (event) => {
      const recoverable = event?.error === 'no-speech' || event?.error === 'aborted';
      if (recoverable && keepSpeechRecognitionAliveRef.current) return;
      if (!sessionClosedRef.current && answerCaptureModeRef.current === 'speech' && allowRecordingFallback) {
        keepSpeechRecognitionAliveRef.current = false;
        startRecordedAnswer();
      }
    };
    try {
      rec.start();
    } catch {
      if (allowRecordingFallback) startRecordedAnswer();
      return;
    }
    recognitionRef.current = rec;
    answerCaptureModeRef.current = 'speech';
    keepSpeechRecognitionAliveRef.current = true;
    lastAnswerActivityAtRef.current = Date.now();
    silencePromptedRef.current = false;
    setIsListening(true);
  };

  const finishRecordedAnswer = async () => {
    const recorder = answerRecorderRef.current;
    if (!recorder || answerCaptureModeRef.current !== 'recording') return '';

    const chunksReady = new Promise((resolve) => {
      recorder.onstop = () => {
        if (answerStreamRef.current) {
          answerStreamRef.current.getTracks().forEach(track => track.stop());
          answerStreamRef.current = null;
        }
        resolve();
      };
    });

    try { recorder.requestData?.(); } catch {}
    try {
      if (recorder.state === 'recording') recorder.stop();
    } catch {}
    await chunksReady;

    const usedType = recorder.mimeType || 'audio/webm';
    answerRecorderRef.current = null;
    answerCaptureModeRef.current = null;
    setIsListening(false);
    setInterimText('');

    if (!answerChunksRef.current.length) return '';

    try {
      setIsProcessingAnswer(true);
      const blob = new Blob(answerChunksRef.current, { type: usedType });
      const formData = new FormData();
      formData.append('audio', blob, getRecordedAudioFileName('interview-answer', blob.type));
      const response = await interviewAPI.transcribe(interview._id, formData);
      const text = normalizeSpeechTranscript(
        response.data?.text || response.data?.transcript || '',
        interview.resumeText,
      );
      addCandidateTranscript(text);
      return text.trim();
    } catch (err) {
      const timedOut = err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message || ''));
      const msg = timedOut
        ? 'Transcription timed out. Please click Start answer and try again.'
        : 'Could not transcribe your answer. Please try again.';
      setTranscript(prev => [...prev, {
        role: 'system',
        text: msg,
      }]);
      toast.error(msg);
      return '';
    } finally {
      setIsProcessingAnswer(false);
      answerChunksRef.current = [];
    }
  };

  const finishUserAnswer = async () => {
    if (ending || isProcessingAnswer || isSubmittingAnswerRef.current) return;

    if (answerCaptureModeRef.current === 'recording') {
      const recordedAnswer = await finishRecordedAnswer();
      if (recordedAnswer) submitAnswer(recordedAnswer);
      return;
    }

    const ans = getAnswerSinceLastQuestion();
    stopListening();
    if (ans) submitAnswer(ans);
  };

  // Prefer browser speech recognition locally; fall back to recorded Whisper upload if it fails.
  // Recorded Whisper needs a real GROQ_API_KEY — without it, Start answer would appear broken after Stop.
  const prefersRecordedInput = () => false;

  const handleAnswerButton = () => {
    if (ending || isProcessingAnswer || isSpeaking) return;
    if (supportsFullscreen() && !isAppFullscreen()) {
      requestAppFullscreen()
        .then(() => console.info('[fullscreen] entered (start_answer)'))
        .catch((error) => {
          const message = formatFullscreenError(error);
          console.warn('[fullscreen] start_answer failed:', message, error);
          toast.warning(`Fullscreen could not start: ${message}`);
        });
    }
    if (isListening || answerCaptureModeRef.current) {
      finishUserAnswer();
      return;
    }
    const bufferedAnswer = getAnswerSinceLastQuestion();
    if (bufferedAnswer) {
      submitAnswer(bufferedAnswer);
      return;
    }
    const hasTypedDesign = isDesignQuestion(questions[currentIdx]) && designNotes.trim();
    if (hasTypedDesign) {
      submitAnswer('');
      return;
    }
    startListening({
      allowRecordingFallback: true,
      preferRecording: prefersRecordedInput(),
    });
  };

  const handleSubmitCode = (editorValue) => {
    if (typeof editorValue === 'string') {
      codingSourceRef.current = editorValue;
      setCodingSource(editorValue);
    }
    if (ending || isProcessingAnswer || isSpeaking) return;
    const liveCode = typeof editorValue === 'string' ? editorValue : codingSourceRef.current;
    const hasTypedCode = liveCode.trim() && !isLanguageStarter(liveCode);
    if (!hasTypedCode) return;
    if (isListening || answerCaptureModeRef.current) {
      finishUserAnswer();
      return;
    }
    submitAnswer(getAnswerSinceLastQuestion() || '');
  };

  const submitAnswer = async (answerText, skipped = false) => {
    if (sessionClosedRef.current || ending || isSubmittingAnswerRef.current) return;
    const isCoding = isCodingQuestion(questions[currentIdx]);
    const isDesign = isDesignQuestion(questions[currentIdx]);
    const liveCode = codingSourceRef.current || codingSource;
    const codeBlock = isCoding && liveCode.trim() && !isLanguageStarter(liveCode)
      ? liveCode.trim()
      : '';
    const designBlock = isDesign && designNotes.trim() ? designNotes.trim() : '';
    if (!answerText && !skipped && !codeBlock && !designBlock) return;
    isSubmittingAnswerRef.current = true;
    setIsProcessingAnswer(true);
    try {
      const q = questions[currentIdx]?.question || '';
      const spokenAnswer = answerText || '';
      const combinedAnswer = [
        spokenAnswer,
        codeBlock ? `Submitted code (${codingLanguage}):\n${codeBlock}` : '',
        designBlock ? `Design whiteboard notes:\n${designBlock}` : '',
      ].filter(Boolean).join('\n\n') || '(skipped)';
      if (import.meta.env.DEV && codeBlock) {
        console.debug('[coding-submit] editor value sent', {
          language: codingLanguage,
          chars: codeBlock.length,
          preview: codeBlock.slice(0, 240),
        });
      }
      const response = await interviewAPI.submitAnswer(interview._id, q, combinedAnswer);
      const state = response.data?.state;
      const evaluation = response.data?.evaluation;
      const nextQuestions = state?.questions || response.data?.interview?.questions;
      const nextIndex = Number.isInteger(state?.currentQuestionIndex) ? state.currentQuestionIndex : currentIdx + 1;
      const nextQuestion = state?.currentQuestion || nextQuestions?.[nextIndex];

      if (Array.isArray(nextQuestions)) setQuestions(nextQuestions);
      if (state?.totalQuestions) setTotalQuestions(state.totalQuestions);
      if (state?.liveScores) setLiveScores(state.liveScores);
      if (evaluation) {
        setLatestEvaluation(evaluation);
        toastEvaluationFeedback(toast, evaluation);
      }
      currentAnswerPartsRef.current = [];
      setInterimText('');
      setCurrentIdx(nextIndex);
      onInterviewUpdate?.({
        ...(response.data?.interview || {}),
        questions: nextQuestions || questions,
        currentQuestionIndex: nextIndex,
        liveScores: state?.liveScores || liveScores,
      });

      if (nextQuestion?.question) {
        window.setTimeout(() => {
          if (!sessionClosedRef.current) speakQuestion(nextQuestion.question);
        }, persona?.questionPauseMs ?? 700);
      } else {
        finishSession();
      }
    } catch (err) {
      const status = err?.response?.status;
      const code = err?.response?.data?.code;
      let message = 'Could not submit your answer. Please check your connection and click Submit answer again.';
      if (status === 401 || code === 'UNAUTHORIZED') {
        message = 'Your session expired. Sign in again — answers already submitted were saved. Re-open this interview from Resume In Progress if available.';
        try {
          window.dispatchEvent(new CustomEvent('fluentai:auth-expired', {
            detail: { silent: false },
          }));
        } catch {}
      } else if (!err?.response) {
        message = 'Network error while submitting. Check your connection and retry — your answer is still in the buffer.';
      } else if (status === 429) {
        message = err?.response?.data?.message || 'Too many requests. Wait a moment and retry.';
      }
      setTranscript(prev => [...prev, { role: 'system', text: message }]);
      toast.error(message);
    } finally {
      isSubmittingAnswerRef.current = false;
      setIsProcessingAnswer(false);
    }
  };

  const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const currentQ = questions[currentIdx];
  const answerPreview = getAnswerSinceLastQuestion();
  const showCodingWorkspace = isCodingQuestion(currentQ);
  const showDesignWhiteboard = isDesignQuestion(currentQ);
  const hasBufferedAnswer = !isListening && Boolean(
    answerPreview
    || (showDesignWhiteboard && designNotes.trim()),
  );
  const showStartAnswerPrompt = Boolean(
    currentQ
    && awaitingAnswerStart
    && !isSpeaking
    && !isListening
    && !isProcessingAnswer
    && !ending
    && !hasBufferedAnswer,
  );
  const speakingStatusLabel = isSpeaking
    ? `${persona?.name || 'Interviewer'} is speaking`
    : isListening
      ? `${candidateName} is speaking`
      : '';

  const playCurrentQuestion = () => {
    if (!currentQ?.question || sessionClosedRef.current || ending || isListening || isProcessingAnswer) return;
    stopListening();
    stopSpeech();
    speakQuestion(currentQ.question, false);
  };

    return (
    <div className={`iv-live${ending ? ' iv-live--ending' : ''}`} role="main" aria-label="Live VFSTR.AI interview">
      {showFullscreenPrompt && supportsFullscreen() && !ending && (
        <div className="iv-fullscreen-prompt" role="dialog" aria-modal="true" aria-label="Enter fullscreen">
          <div className="iv-fullscreen-prompt__card">
            <h2>Enter fullscreen</h2>
            <p>
              This interview runs in fullscreen so we can detect if you leave the session.
              Click below to continue — your browser may ask you to confirm.
            </p>
            <button type="button" className="iv-btn iv-btn--primary" onClick={handleEnterFullscreen}>
              Enter fullscreen
            </button>
          </div>
        </div>
      )}
      {tabConflict && (
        <div className="iv-ending-overlay" role="alertdialog" aria-modal="true" aria-label="Interview open in another tab">
          <InterviewLoader
            title="Interview open in another tab"
            message="This session is already live elsewhere. Close this tab and continue in the original one to avoid score corruption."
          />
        </div>
      )}
      {ending && (
        <div className="iv-ending-overlay" role="status" aria-live="polite">
          <InterviewLoader title="Ending interview" message="Saving your responses and preparing your results." />
        </div>
      )}
      {integrityEndMessage && (
        <div className="iv-ending-overlay" role="alertdialog" aria-modal="true" aria-label="Interview ended for integrity reasons">
          <div className="iv-integrity-end-card">
            <span className="iv-integrity-end-card__icon" aria-hidden="true">!</span>
            <h2>Interview ended early</h2>
            <p>{integrityEndMessage}</p>
            <span>Opening your interview report…</span>
          </div>
        </div>
      )}

      {/* Session status bar */}
      <div className="iv-proctor-bar" role="status" aria-live="polite">
        <div className="iv-proctor-bar__chips">
          <span
            className="iv-proctor-chip iv-proctor-chip--timer"
            aria-label={`Time remaining ${fmtTime(timer)}`}
          >
            <span className="iv-proctor-chip__label">Time</span>
            <span className="iv-timer" data-warn={timer < 300}>{fmtTime(timer)}</span>
          </span>
          <span
            className="iv-proctor-chip iv-proctor-chip--question"
            aria-label={`Question ${Math.min(currentIdx + 1, totalQuestions || questions.length)} of ${totalQuestions || questions.length}`}
          >
            <span className="iv-proctor-chip__label">Question</span>
            <span className="iv-q-counter">
              {Math.min(currentIdx + 1, totalQuestions || questions.length)} / {totalQuestions || questions.length}
            </span>
          </span>
          <span className="iv-proctor-chip iv-proctor-chip--live" aria-hidden="true">
            <span className="iv-rec-dot" aria-hidden="true">●</span>
            <span>Live</span>
          </span>
          <span
            className={`iv-proctor-chip iv-proctor-chip--camera iv-camera-status${proctorCameraStatus === 'ok' ? ' iv-camera-status--ok' : proctorCameraStatus === 'missing' ? ' iv-camera-status--warn' : ''}`}
          >
            {!cameraReady
              ? PROCTOR_STATUS_LABELS.off
              : PROCTOR_STATUS_LABELS[proctorCameraStatus] || PROCTOR_STATUS_LABELS.checking}
          </span>
          {integrityViolationCount > 0 && (
            <span
              className="iv-proctor-chip iv-proctor-chip--integrity iv-violation-count"
              aria-label={`${integrityViolationCount} of 3 integrity warnings used`}
            >
              Integrity {Math.min(integrityViolationCount, 3)} / 3
            </span>
          )}
        </div>
        <span className={`iv-proctor-status${isSpeaking ? ' iv-proctor-status--speaking' : ''}${isListening ? ' iv-proctor-status--listening' : ''}`}>
          {isSpeaking ? 'Interviewer speaking' : isListening ? 'Listening for your answer' : 'Ready for you'}
        </span>
      </div>
      {integrityWarning && (
        <div className="iv-integrity-banner iv-integrity-banner--warning" role="alert">
          {integrityWarning}
        </div>
      )}
      {faceWarning && (
        <div className="iv-integrity-banner iv-integrity-banner--face" role="alert">
          {faceWarning}
        </div>
      )}
      {clipboardNotice && (
        <div className="iv-integrity-banner iv-integrity-banner--clipboard" role="status" aria-live="polite">
          {clipboardNotice}
        </div>
      )}

      <div className="iv-session-body">
        {/* Primary: student's camera, with the interviewer as a secondary tile */}
        <div className="iv-avatar-panel">
          <header className="iv-avatar-panel__head">
            <h2 className="iv-avatar-panel__title">Your video</h2>
            <span className="iv-avatar-panel__meta">{persona?.name || 'Interviewer'} · secondary tile</span>
          </header>
          <div className="iv-camera-stage">
            <video ref={videoRef} muted playsInline className="iv-primary-camera" aria-label="Your camera preview" />
            {!cameraReady && <span className="iv-camera-placeholder">Camera preview unavailable</span>}
            <div className="iv-avatar-pip" aria-label={`${persona?.name || 'Interviewer'} secondary tile`}>
              <div className="iv-avatar-wrap">
                <AvatarPortrait persona={persona} isSpeaking={isSpeaking} audioLevel={audioLevel} isListening={isListening} />
              </div>
              <span className="iv-avatar-pip-label">{persona?.name || 'Interviewer'}</span>
            </div>
          </div>
          {speakingStatusLabel ? (
            <p className="iv-speaking-status" aria-live="polite">{speakingStatusLabel}</p>
          ) : null}
        </div>

        {/* Right: Transcript */}
        <div className="iv-transcript-panel">
          <header className="iv-transcript-header">
            <div>
              <h2 className="iv-transcript-title">Conversation</h2>
              <p className="iv-transcript-sub">With {persona?.name || 'your interviewer'}</p>
            </div>
            <span className={`iv-transcript-session-badge${isSpeaking ? ' iv-transcript-session-badge--speaking' : ''}${isListening ? ' iv-transcript-session-badge--listening' : ''}`}>
              {isSpeaking ? 'Speaking' : isListening ? 'Recording' : 'In session'}
            </span>
          </header>
          <div className="iv-transcript-scroll-wrap">
            <div
              ref={transcriptScrollRef}
              className="iv-transcript-scroll"
              aria-live="polite"
              aria-relevant="additions"
              onScroll={handleTranscriptScroll}
            >
              {transcript.map((msg, i) => (
                <div key={i} className={`iv-msg iv-msg--${msg.role}`}>
                  <span className="iv-msg-role">
                    {msg.role === 'interviewer' ? persona?.name : msg.role === 'candidate' ? 'You' : 'System'}
                  </span>
                  <span className="iv-msg-text">{msg.text}</span>
                </div>
              ))}
              {interimText && (
                <div className="iv-msg iv-msg--interim">
                  <span className="iv-msg-role">You (speaking…)</span>
                  <span className="iv-msg-text">{interimText}</span>
                </div>
              )}
            </div>
            {hasNewTranscript && (
              <button
                type="button"
                className="iv-transcript-new-message"
                onClick={() => scrollTranscriptToLatest()}
              >
                New message ↓
              </button>
            )}
          </div>

          {currentQ && (
            <div className="iv-current-q" role="region" aria-label="Current interview question" tabIndex={0}>
              <div className="iv-current-q__head">
                <span className="iv-current-q-label">Current question</span>
                <span className="iv-current-q-index">
                  {Math.min(currentIdx + 1, totalQuestions || questions.length)} of {totalQuestions || questions.length}
                </span>
              </div>
              <p className="iv-current-q-text">{currentQ.question}</p>
            </div>
          )}

          {showCodingWorkspace && (
            <LiveCodingPanel
              language={codingLanguage}
              onLanguageChange={(value, options = {}) => {
                setCodingLanguage(value);
                setCodingSource((prev) => {
                  const next = options.keepCode || (prev.trim() && !isLanguageStarter(prev))
                    ? prev
                    : languageStarter(value);
                  codingSourceRef.current = next;
                  return next;
                });
              }}
              value={codingSource}
              onChange={(next) => {
                codingSourceRef.current = next;
                setCodingSource(next);
              }}
              prompt={currentQ?.question || 'Write your approach or code here.'}
              isMobile={isLikelyMobileDevice()}
              onSubmitCode={handleSubmitCode}
              submitting={isProcessingAnswer}
              submitDisabled={ending || (isSpeaking && !isListening)}
              isListening={isListening}
              onClipboardAttempt={handleClipboardAttempt}
            />
          )}

          {showDesignWhiteboard && (
            <DesignWhiteboard
              value={designNotes}
              onChange={setDesignNotes}
              prompt={currentQ?.question || 'Outline your architecture and trade-offs.'}
              onClipboardAttempt={handleClipboardAttempt}
            />
          )}

          <div className="iv-controls">
            {showStartAnswerPrompt ? (
              <p className="iv-start-answer-hint" id="iv-start-answer-hint" aria-live="polite">
                Click <strong>Start answer</strong> when you&apos;re ready to respond
              </p>
            ) : null}
            <div className="iv-controls__actions">
              <div className="iv-controls__secondary">
                <button
                  type="button"
                  className="iv-btn iv-btn--ghost iv-btn--compact"
                  disabled={ending || isProcessingAnswer || isSpeaking || isListening || !currentQ}
                  onClick={playCurrentQuestion}
                  title={isListening ? 'Stop answering before replaying the question' : undefined}
                >
                  Replay question
                </button>
                <button
                  type="button"
                  className="iv-btn iv-btn--ghost iv-btn--compact"
                  disabled={ending || isProcessingAnswer || isSpeaking}
                  onClick={() => { stopListening(); submitAnswer('', true); }}
                >
                  Skip
                </button>
                <button
                  type="button"
                  className="iv-btn iv-btn--ghost iv-btn--compact iv-btn--finish"
                  disabled={ending || isProcessingAnswer}
                  onClick={() => finishSession({ speakClosing: true })}
                >
                  {ending
                    ? <span className="iv-btn-loading"><span className="iv-btn-spinner" />Ending</span>
                    : 'End interview'}
                </button>
              </div>
              <button
                type="button"
                className={`iv-btn iv-btn--answer${isListening ? ' iv-btn--danger' : ' iv-btn--primary'}${showStartAnswerPrompt ? ' iv-btn--prompt-pulse' : ''}`}
                disabled={ending || isProcessingAnswer || (isSpeaking && !isListening)}
                onClick={handleAnswerButton}
                aria-describedby={showStartAnswerPrompt ? 'iv-start-answer-hint' : undefined}
                title={
                  isSpeaking && !isListening
                    ? 'Wait for the interviewer to finish'
                    : (showCodingWorkspace
                      ? 'Record your spoken explanation (optional). Use Submit code in the editor to send typed code.'
                      : undefined)
                }
              >
                {isProcessingAnswer
                  ? 'AI checking answer...'
                  : isListening
                    ? 'Stop & submit'
                    : hasBufferedAnswer
                      ? 'Submit answer'
                      : 'Start answer'}
              </button>
            </div>
          </div>
          {voiceDiagnostics?.quietAudioDetected && (
            <div className="iv-audio-diagnostics iv-audio-diagnostics--warn" role="alert">
              Your microphone seems quiet. Move closer or check your input settings so your answer is captured clearly.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Main Interview Component
───────────────────────────────────────────────────────────────── */
export const Interview = ({ setCurrentView }) => {
  const toast = useToast();
  const [step, setStep]         = useState(0);
  const [data, setData]         = useState({});
  const [interview, setInterview] = useState(null);
  const [loading, setLoading]   = useState(false);
  const startingRef = useRef(false);
  const [resuming, setResuming] = useState(true);
  const [error, setError]       = useState('');
  const persona =
    data.persona
    || PERSONAS.find((p) => p.id === interview?.personaId)
    || PERSONAS[0];

  const next = partial => { setData(prev => ({ ...prev, ...partial })); setStep(s => s + 1); };
  const back = () => setStep(s => s - 1);

  useEffect(() => {
    let cancelled = false;
    const resumeActive = async () => {
      try {
        const activeId = localStorage.getItem(ACTIVE_INTERVIEW_KEY);
        if (!activeId) return;
        const savedPersona = (() => {
          try { return JSON.parse(localStorage.getItem(ACTIVE_PERSONA_KEY) || 'null'); } catch { return null; }
        })();
        const res = await interviewAPI.getInterview(activeId);
        const active = res.data;
        if (cancelled) return;
        if (active?.status === 'In Progress') {
          setData(prev => ({ ...prev, persona: savedPersona || PERSONAS.find(p => p.id === active.personaId) || PERSONAS[0] }));
          setInterview(active);
          setStep(LIVE_STEP);
        } else {
          localStorage.removeItem(ACTIVE_INTERVIEW_KEY);
          localStorage.removeItem(ACTIVE_PERSONA_KEY);
        }
      } catch {
        localStorage.removeItem(ACTIVE_INTERVIEW_KEY);
        localStorage.removeItem(ACTIVE_PERSONA_KEY);
      } finally {
        if (!cancelled) setResuming(false);
      }
    };
    resumeActive();
    return () => { cancelled = true; };
  }, []);

  const handleStart = async () => {
    if (startingRef.current || loading) return;
    startingRef.current = true;
    try {
      setLoading(true); setError('');
      const correctedResumeText = data.correctedResumeText?.trim();
      const roleLevel = data.config?.roleLevel || 'Fresher';
      const payload = {
        roleLevel,
        roleDomain:      data.config?.roleDomain || 'SDE',
        interviewStyle:  'Mixed',
        duration:        30,
        resumeId:        correctedResumeText ? undefined : data.resume?._id,
        resumeText:      correctedResumeText || data.resume?.rawText || data.resume?.extractedText,
        personaId:       data.persona?.id,
        interviewType:   'Mixed',
        interviewMode:   data.config?.interviewMode || 'sde',
        complexity:      data.config?.complexity || complexityForLevel(roleLevel),
        jobDescription:  data.config?.jobDescription?.trim() || undefined,
        targetCompany:   data.config?.targetCompany || undefined,
      };
      const res = await interviewAPI.createInterview(payload);
      const startRes = await interviewAPI.startInterview(res.data._id, data.networkQualityTier);
      const liveInterview = startRes.data?.interview ?? res.data;
      try {
        localStorage.setItem(ACTIVE_INTERVIEW_KEY, liveInterview._id);
        localStorage.setItem(ACTIVE_PERSONA_KEY, JSON.stringify(data.persona || PERSONAS[0]));
      } catch {}
      setInterview(liveInterview);
      setStep(LIVE_STEP);
      toast.success('Interview started. Good luck!');
    } catch (err) {
      const status = err?.response?.status;
      const code = err?.response?.data?.code;
      const apiMessage = err?.response?.data?.message || err?.response?.data?.error;
      const retryable = err?.response?.data?.retryable === true || status === 429 || status === 503;
      let msg = '';
      if (status === 429 || code === 'RATE_LIMITED' || code === 'INTERVIEW_START_BUSY') {
        msg = apiMessage || 'Server is busy. Please wait a moment and retry.';
      } else if (status === 503 || /mongo|database|ECONNREFUSED/i.test(String(apiMessage || err?.message || ''))) {
        msg = apiMessage || 'Database unavailable. Check that MongoDB is running, then retry.';
      } else if (!err?.response) {
        msg = 'Network error — could not reach the interview API. Check your connection and retry.';
      } else {
        msg = apiMessage || (retryable ? 'Failed to start interview. Please retry.' : 'Failed to start interview.');
      }
      setError(msg);
      toast.error(msg);
      startingRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  if (resuming) {
    return (
      <div className="iv-container">
        <InterviewLoader title="Checking for an active interview" message="Restoring your progress if you left mid-session." />
      </div>
    );
  }

  if (step === LIVE_STEP && interview) {
    return (
      <LiveSession
        interview={interview}
        persona={persona}
        onInterviewUpdate={(nextInterview) => {
          setInterview(nextInterview);
          try {
            if (nextInterview?._id) localStorage.setItem(ACTIVE_INTERVIEW_KEY, nextInterview._id);
          } catch {}
        }}
        onComplete={(interviewId) => {
          try {
            if (interviewId) localStorage.setItem(OPEN_REPORT_KEY, interviewId);
          } catch {}
          setCurrentView?.('results');
        }}
      />
    );
  }

  return (
    <div className="iv-container iv-container--wizard">
      <div className="iv-wizard-top">
        <div className="iv-wizard-intro">
          <p className="iv-wizard-eyebrow">Mock interview setup</p>
          <h1 className="iv-wizard-title">Prepare your session</h1>
        </div>
        <div className="iv-stepper">
          {STEPS.map((label, i) => (
            <div key={label}
              className={`iv-step-dot${i < step ? ' iv-step-dot--done' : i === step ? ' iv-step-dot--active' : ''}`}>
              <span className="iv-step-num">{i < step ? '✓' : i + 1}</span>
              <span className="iv-step-label">{label}</span>
            </div>
          ))}
        </div>
      </div>
      {error && <p className="iv-error iv-error--center">{error}</p>}
      {step === 0 && <ResumeStep onNext={next} />}
      {step === 1 && (
        <ResumeIntelligenceStep
          resume={data.resume}
          onNext={next}
          onBack={back}
        />
      )}
      {step === 2 && <ConfigStep onNext={next} onBack={back} />}
      {step === 3 && <NetworkCheckStep onNext={next} onBack={back} />}
      {step === 4 && <SystemCheckStep onStart={handleStart} onBack={back} loading={loading} />}
    </div>
  );
};

export default Interview;
