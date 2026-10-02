import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import { isDatabaseConnected } from './config/database';
import { apiLimiter } from './middleware/rateLimiter';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import interviewRoutes from './routes/interview.routes';
import resumeRoutes from './routes/resume.routes';
import scheduleRoutes from './routes/schedule.routes';
import reportRoutes from './routes/report.routes';
import ttsRoutes from './routes/tts.routes';
import institutionRoutes from './routes/institution.routes';
import adminRoutes from './routes/admin.routes';
import notificationRoutes from './routes/notification.routes';

export const createApp = () => {
  const app = express();

  // Needed so rate-limit / req.ip work correctly behind Render/nginx.
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // TF.js compiles shaders / kernels; BlazeFace fetches model weights from Google Storage.
          scriptSrc: ["'self'", "'unsafe-eval'", 'blob:'],
          connectSrc: [
            "'self'",
            'blob:',
            'https://storage.googleapis.com',
            'https://tfhub.dev',
            'https://www.kaggle.com',
          ],
          workerSrc: ["'self'", 'blob:'],
          childSrc: ["'self'", 'blob:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'data:', 'blob:', 'mediastream:'],
        },
      },
      hsts: env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  if (env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '');
      if (proto.split(',')[0].trim() !== 'https') {
        const host = req.headers.host || '';
        res.redirect(301, `https://${host}${req.originalUrl}`);
        return;
      }
      next();
    });
  }
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          callback(null, true);
          return;
        }
        if (process.env.RENDER_EXTERNAL_HOSTNAME) {
          try {
            if (new URL(origin).hostname === process.env.RENDER_EXTERNAL_HOSTNAME) {
              callback(null, true);
              return;
            }
          } catch {
            // Fall through to the configured allowlist.
          }
        }
        if (env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS origin not allowed: ${origin}`));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
    }),
  );
  app.use(compression());
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(csrfProtection);
  app.use(apiLimiter);

  app.get('/api/health', (_req, res) => {
    const mongodb = isDatabaseConnected() ? 'connected' : 'disconnected';
    const hasLlm = Boolean(env.GROQ_API_KEY || env.OPENAI_API_KEY);
    const hasTts = Boolean(env.ELEVENLABS_API_KEY || env.SARVAM_API_KEY);
    const warnings: string[] = [];
    if (mongodb !== 'connected') warnings.push('MongoDB is disconnected. Interviews and reports cannot be saved.');
    if (!hasLlm) warnings.push('No GROQ_API_KEY or OPENAI_API_KEY configured. AI quality will degrade.');
    if (!hasTts) warnings.push('No TTS key configured (ElevenLabs/Sarvam). Browser voice fallback will be used.');

    const degraded = mongodb !== 'connected' || !hasLlm;
    res.status(mongodb === 'connected' ? 200 : 503).json({
      status: degraded ? 'degraded' : 'ok',
      service: 'fluentai-interview',
      timestamp: new Date().toISOString(),
      mongodb,
      node: process.version,
      capabilities: {
        llm: hasLlm,
        tts: hasTts,
        stt: hasLlm,
      },
      warnings,
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/interviews', interviewRoutes);
  app.use('/api/resumes', resumeRoutes);
  app.use('/api/schedules', scheduleRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/tts', ttsRoutes);
  app.use('/api/institutions', institutionRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/interviews', interviewRoutes);
  app.use('/api/v1/resumes', resumeRoutes);
  app.use('/api/v1/schedules', scheduleRoutes);
  app.use('/api/v1/reports', reportRoutes);
  app.use('/api/v1/tts', ttsRoutes);
  app.use('/api/v1/institutions', institutionRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/notifications', notificationRoutes);

  const clientDistPath = path.resolve(__dirname, '../../client/dist');
  const clientIndexPath = path.join(clientDistPath, 'index.html');
  if (fs.existsSync(clientIndexPath)) {
    app.use(express.static(clientDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(clientIndexPath);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
