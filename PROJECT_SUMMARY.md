# EduAI Platform - AI Mock Interview Implementation

## Overview

EduAI is a full-stack AI mock interview platform with authentication, resume analysis, AI-led interviews, scheduling, reporting, and analytics. The backend has been upgraded to a modular TypeScript architecture under `server/src`.

## Production Architecture

### Backend

- Node.js, Express.js, TypeScript
- Vite-powered React client on port `5173`
- MongoDB via Mongoose
- Redis for sessions, OTPs, refresh-token blacklist, interview state, and reminder metadata
- BullMQ for email and reminder queues
- JWT access tokens and rotating refresh tokens
- Zod validation, centralized error handling, Helmet, CORS, compression, logging, and rate limiting

### Integrations

- **MongoDB**: users, auth sessions, resumes, interviews, schedules, reports, questions, and practice sessions
- **JWT**: access tokens and refresh tokens
- **Redis**: session storage, refresh-token blacklist, OTP cache, interview state cache, and reminder cache
- **Google OAuth**: Google ID token login
- **Resend**: verification, password reset, reminder, and notification emails
- **BullMQ**: queued outgoing email and delayed interview reminders
- **OpenAI/Groq**: interview question generation, answer evaluation, resume analysis, and report generation
- **ElevenLabs**: AI interviewer voice synthesis
- **Cloudinary**: resume, recording, profile/report media storage

## Key Backend Files

```text
server/src/
  app.ts
  server.ts
  config/
  controllers/
  middleware/
  models/
  routes/
  services/
  utils/
  __tests__/
```

## Main API Areas

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `POST /api/auth/verify-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/profile`

### AI Interviews

- `POST /api/interviews`
- `GET /api/interviews/user-interviews`
- `POST /api/interviews/start`
- `POST /api/interviews/answer`
- `POST /api/interviews/complete`
- `GET /api/interviews/:id/state`
- `POST /api/interviews/:id/speak`
- `POST /api/interviews/:id/recording`

### Resumes

- `POST /api/resumes`
- `GET /api/resumes`
- `GET /api/resumes/:id`

### Scheduling

- `POST /api/schedules`
- `GET /api/schedules`
- `PUT /api/schedules/:id`
- `DELETE /api/schedules/:id`

### Reports

- `GET /api/reports`
- `GET /api/reports/:id`

## Environment

Copy `server/.env.example` to `server/.env` and configure MongoDB, Redis, JWT/cookie secrets, Google OAuth, Resend or SMTP, Groq/OpenAI, ElevenLabs, and Cloudinary keys. Copy `client/.env.example` to `client/.env`; the client reads `VITE_API_URL`, which defaults to `http://localhost:4000`.

## Scripts

```bash
cd server
npm run dev
npm run build
npm test
```

Root scripts:

```bash
npm run dev
npm run build
npm test
```

## Verification

- `npm run build` passes for the TypeScript backend.
- `npm test` passes the backend health smoke test.
