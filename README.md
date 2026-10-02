# FluentAI Interview-Only

Standalone package of the **AI Mock Interview** workflow from FluentAI.

LSRW Practice (Listening / Speaking / Reading / Writing), Mixed Tests, and Admin CMS are **not** included.

## What is included

Same interview UI and functionality as the full app:

1. Auth (register / login / Google OAuth if configured)
2. Dashboard (interview-focused)
3. Resume upload & review
4. Interviewer persona selection + voice preview
5. Role / company / mode setup + system check
6. Live adaptive interview (camera, mic, TTS, STT, coding answers)
7. Interview reports / scorecard (PDF)

## Quick start

1. Copy env files:
   - `server/.env.example` → `server/.env`
   - `client/.env.example` → `client/.env`
2. Fill MongoDB, JWT, AI (Groq/OpenAI), TTS (Sarvam/ElevenLabs), and Cloudinary keys in `server/.env`.
3. Install and run:

```bash
npm run install-all
npm run dev
```

- Client: http://localhost:5173  
- API: http://localhost:4000  

## Interview flow

`Resume → Review → Interviewer → Setup → System Check → Live Interview → Report`

## Notes

- Uses the same MongoDB collections for users, resumes, interviews, and reports.
- No Listening/Speaking/Reading/Writing journey seeding is required.
- Optional: `npm --workspace server run seed:company-questions`
