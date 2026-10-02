# FluentAI Mock Interview — QA Test Case Checklist

**Product:** FluentAI Interview-Only  
**Audience:** QA team (~20 testers)  
**Environment:** Node 22, Client `http://localhost:5173`, API `http://localhost:4000`, MongoDB up, valid Groq/TTS keys  

### Severity legend

| Severity | Meaning |
|----------|---------|
| **P0** | Blocks interview or loses data — fix before release |
| **P1** | Breaks trust in questions/scores/voice — must fix soon |
| **P2** | UX / polish / browser issues — schedule fix |
| **P3** | Nice-to-have / edge / scale — backlog |

### How to use

1. Assign sections A–N across testers (2–3 people per section recommended).  
2. For each case: run **Steps**, compare to **Expected**, mark **Pass / Fail / Blocked**.  
3. On Fail: attach screenshot, browser, interview id, and timestamp.  
4. Prefer Chrome for baseline; re-run P0/P1 on Firefox + Safari + one mobile device.

### Golden test data

| ID | Profile | Use for |
|----|---------|---------|
| G1 | Fresher SDE resume (2 projects, Python/React) | Default path |
| G2 | Mid Backend resume (Java/Spring) | Experienced depth |
| G3 | Non-standard PDF / sparse resume | Parse robustness |
| G4 | Amazon / TCS / unknown company | Company flavor |

---

## A. Setup & onboarding

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| A01 | P2 | Setup is short enough | Start interview flow from dashboard | ≤4 steps: Resume → Review → Setup → Ready; primary CTA is **Start Interview** |
| A02 | P0 | Resume PDF upload works | Upload G1 PDF | Upload succeeds; skills/projects shown |
| A03 | P1 | Scanned/image PDF handling | Upload scanned/image-only PDF | Clear error **or** partial extract + warning — no silent empty resume |
| A04 | P1 | Skills extracted correctly | Upload G1; open Review | Major skills (e.g. Python, React) present; not only soft skills |
| A05 | P1 | Projects extracted with exact names | Upload G1 | Exact project names (e.g. PDF Knowledge Chatbot) — not renamed |
| A06 | P2 | Review step clarity | On Review, change nothing; continue | Continue works; optional edit path is obvious |
| A07 | P2 | Optional JD | Leave JD empty; complete setup | Interview still starts |
| A08 | P1 | JD influences questions | Paste SDE JD with React/Node; run 30m interview | ≥1 question references JD tech |
| A09 | P2 | Company list usable | Open company dropdown | Common companies listed; “none” option works |
| A10 | P1 | Unknown company path | Select/type obscure company if possible, or leave thin bank | Interview starts; questions are role-based — **no** “official X asks…” claims |
| A11 | P1 | Fresher vs Senior difficulty | Run 15m Fresher vs Senior same resume | Fresher = fundamentals/projects; Senior = ownership/trade-offs/deeper coding |
| A12 | P3 | Duration options | Check duration control | 15 / 30 / 45 available; selected duration reflected in Q count / timer |
| A13 | P1 | Voice preview | On Setup, Preview each persona | Audio plays; Stop works; error message if TTS down |
| A14 | P2 | Persona selection persists | Select persona → Ready → Start | Live session uses that persona name/voice |
| A15 | P0 | Camera deny recovery | Deny camera on Ready; try Start | Clear message; cannot start until allowed **or** documented limitation |
| A16 | P0 | Mic deny recovery | Deny mic; try Start / Start answer | Clear message; cannot fake a successful interview |
| A17 | P2 | Person-in-frame flaky lighting | Dark room / virtual background | Warning OK; **must not** hard-block Start if cam+mic OK |
| A18 | P1 | Ready vs Live media | Pass Ready check; enter live | Cam/mic work in live PiP without re-prompt loop |
| A19 | P3 | Ready checkbox | Uncheck “I am ready”; Start disabled; check again | Start enables only when ready |
| A20 | P1 | Create interview latency | Click Start Interview; measure time | Completes <45s normally; loading state shown; no infinite hang |
| A21 | P0 | Create interview failure UX | Stop API mid-create (or bad key) | User-visible error with retry; not blank screen |
| A22 | P2 | No English-learning residue | Walk Dashboard, Profile, Interview chrome | No CEFR / “Learner English mastery” framing |

---

## B. Auth & account

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| B01 | P0 | Register happy path | Register new user | Account created; can login |
| B02 | P1 | Login wrong password | Login with bad password | Clear error; no stack trace |
| B03 | P0 | Login happy path | Login valid user | Lands on dashboard |
| B04 | P1 | Session expiry mid-interview | Expire/invalidate token during live Q | Prompt to re-login; answers not silently lost if possible |
| B05 | P1 | Logout during live | Logout mid-interview | Session ends safely; no crash |
| B06 | P1 | Two tabs conflict | Same user: Tab A live interview; Tab B also opens interview | No cross-corrupt scores; clear behavior (block or isolate) |
| B07 | P2 | Profile save | Edit name/phone; save | Success toast; values persist after refresh |
| B08 | P2 | Change password | Valid current + new password | Success; old password fails; new works |
| B09 | P2 | Password mismatch | New ≠ confirm | Inline error; no API call success |

---

## C. Live interview — controls & flow

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| C01 | P1 | Start answer while TTS | Wait until interviewer speaking; click Start answer | Disabled **or** clearly blocked; tooltip/reason OK |
| C02 | P0 | Start answer captures speech | After TTS ends; Start answer; speak 15s; Stop | Transcript shows words |
| C03 | P0 | Empty submit blocked | Start answer; Stop with silence | No false high score; prompt to retry or skip |
| C04 | P2 | Skip behavior | Click Skip on Q2 | Moves to next Q; report marks skipped |
| C05 | P0 | End Interview always works | Click End mid-session | Overlay → completes → report path; no stuck spinner >60s |
| C06 | P1 | Replay question | Click Replay question | Same Q spoken again; mic not fighting audio |
| C07 | P1 | Spoken = written Q | Note current question text; listen | Spoken content matches text |
| C08 | P1 | Question counter accuracy | Answer 3 adaptive Qs | Counter matches current index / total |
| C09 | P1 | Timer display | Start 15m interview | Timer ~15:00 and counts down |
| C10 | P2 | Timer expiry | Let timer hit 0 (or mock) | Interview ends or prompts End; state consistent |
| C11 | P2 | Fullscreen behavior | Start live on desktop | Fullscreen preferred; exit doesn’t brick interview |
| C12 | P3 | Proctor soft logs | Switch tab briefly | Interview continues; no scary blocking modal (unless designed) |
| C13 | P2 | Clipboard blocked | Try Ctrl+C on question | Paste into notes blocked per rules; no crash |
| C14 | P0 | Refresh mid-interview | On Q4 unanswered; refresh; reopen Interview | Resumes **same** interview at Q4; no forced intro restart |
| C15 | P1 | Refresh after answer | Answer Q3; refresh | Q3 kept answered; current is Q4 |
| C16 | P1 | Intro not re-spoken on resume | Resume from Q5 | No persona intro + no “Tell me about yourself” again |
| C17 | P2 | Abandon without End | Close tab on live | Later: In Progress visible; can resume or discard clearly |
| C18 | P1 | New interview while In Progress | With active In Progress, start setup again | Clear choice: resume vs new; no silent overwrite |

---

## D. Voice (TTS) & STT

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| D01 | P0 | Cloud TTS plays | Normal start with keys | First intro + Q1 audible |
| D02 | P1 | TTS fallback | Break cloud TTS (invalid key); start | Browser voice fallback **or** clear “audio unavailable” — not silent forever |
| D03 | P2 | TTS completeness | Long question | Full question spoken (not cut early) |
| D04 | P2 | TTS volume usable | Default device volume 50% | Audible without strain |
| D05 | P0 | No TTS/mic fight | Start answer only after speech ends | Recording clean; no doubled audio |
| D06 | P1 | Firefox STT | Run Start answer on Firefox | Works **or** documented fallback to recording |
| D07 | P1 | Safari STT | Same on Safari | Works **or** clear unsupported message |
| D08 | P0 | Whisper/Groq failure UX | Force transcribe failure | User told to retry; not infinite “Checking answer” |
| D09 | P1 | ASR garbage not treated as fact | Say “whole text”; if ASR shows “voltage”, next Q | Should ask “Did you mean whole text?” — **not** invent voltage NER |
| D10 | P2 | Long answer transcription | Speak ~90s answer | Most content retained |
| D11 | P2 | Soft speech | Quiet but clear speech | Captures enough to score >0 |
| D12 | P2 | Noise robustness | Light background noise | No flood of junk interim text |
| D13 | P2 | Silence auto-skip | Stay silent 60s+ while listening | System message then skip/next — predictable |
| D14 | P1 | Submit latency | Stop & submit; measure | Next Q <20s typical; loading state shown |

---

## E. Question quality & adaptivity

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| E01 | P1 | Resume-grounded questions | G1 resume; note projects | ≥2 Qs cite exact project names |
| E02 | P0 | Sticky topic limit | Give weak answers on Project A | ≤2 consecutive Qs on Project A; then switch |
| E03 | P0 | No re-ask intro | Complete Q1 intro; continue 5 Qs | No second “Tell me about yourself” |
| E04 | P0 | No meta proceed Q | Struggle / skip twice | Never “Are you ready to proceed?” as scored Q |
| E05 | P1 | Follow-up uses answer detail | Mention “FAISS” / “chunks” in answer | Next clarify references that detail **or** confirms ASR |
| E06 | P1 | One clarify then move | Partial answer | One clarify max, then new topic |
| E07 | P1 | Strong answer goes deeper | Excellent structured answer | Harder follow-up or challenge once |
| E08 | P1 | Coding appears in SDE path | 30m SDE Mixed | ≥1 real coding/DSA style Q |
| E09 | P2 | Not all behavioral | SDE path | Majority technical/project; not HR-only |
| E10 | P1 | Company block present | Select Amazon/TCS | Culture + technical + coding-style company stage appears |
| E11 | P1 | No fake official claims | Company interview | No “Google always asks this exact…” |
| E12 | P2 | Company research timeout | Slow network + obscure company | Falls back role-based; interview continues |
| E13 | P2 | Bank not copy-paste | Amazon fresher | Questions paraphrased / natural spoken |
| E14 | P1 | No near-duplicate Qs | Full 15m run | No two Qs same meaning back-to-back |
| E15 | P1 | No invented resume tech | Answer without claiming Redis | Qs don’t assume Redis unless on resume |
| E16 | P1 | Fresher not crushed | Fresher Beginner | No heavy distributed system design |
| E17 | P1 | Experienced depth | Mid/Senior G2 | Ownership / production / trade-offs appear |
| E18 | P2 | HR/close present | Finish full loop or End late | Behavioral/HR style Q before close **or** spoken wrap |
| E19 | P1 | Stage order roughly held | Log Q topics for 30m | Roughly: intro → projects → coding/role → company → HR |
| E20 | P1 | Adaptive doesn’t break spine | Force many clarifies | Still reaches coding or second project; not stuck |

---

## F. Coding & design panels

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| F01 | P0 | Discussion ≠ coding UI | Q: “In PDF Knowledge Chatbot, how did you apply tokenization? What was the problem, what did you implement…” | **No** Coding Workspace |
| F02 | P0 | Project architecture ≠ whiteboard | Q: “Explain the architecture of your Blood Donation Platform…” | Voice only; no design whiteboard |
| F03 | P1 | Real coding shows editor | Q: “Given an array… return indices… complexity” | Coding Workspace appears |
| F04 | P1 | Real design shows whiteboard | Q: “How would you design a URL shortener…” | Design whiteboard appears |
| F05 | P2 | Language detect | SQL question | Language defaults to SQL |
| F06 | P2 | Language switch keeps real code | Type code; switch language with keep | Code not wiped if “keep” path |
| F07 | P1 | Run/test honesty | Python `n*2` on discussion-turned-coding | Message must **not** imply answer is correct for interview Q |
| F08 | P1 | Code not unfairly scoring discussion | If code submitted on wrong panel historically | Evaluation ignores irrelevant code for discussion topics |
| F09 | P2 | Whiteboard submitted | Fill design notes; submit with speech | Notes included in answer payload |
| F10 | P2 | Coding on mobile | Open coding Q on phone | Usable or clear “use desktop” message |

---

## G. Scoring & evaluation

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| G01 | P1 | Score stability | Same recorded answer text twice (if re-eval path) | Scores within ~15 points |
| G02 | P1 | Skip scoring | Skip 3 questions | Score 0; feedback says no answer; not fake “covered concepts” |
| G03 | P1 | Empty answer | Submit silence/skip | 0–20 band; ideal still resume-grounded |
| G04 | P1 | Vague answer not A-grade | “I used Python and did stuff” | ≤50 |
| G05 | P1 | Good structured answer | STAR + metric + tech | ≥70 |
| G06 | P1 | ASR-damaged but correct intent | Messy speech of real RAG flow | Partial credit; not 0 if pipeline clear |
| G07 | P2 | Feedback specificity | Read What was correct/missing | References actual answer content |
| G08 | P1 | No ASR junk in concepts | Trigger “voltage” ASR | Concepts to revise ≠ voltage extraction science |
| G09 | P2 | Live vs final scores | Note live meters; open report | Final not wildly contradictory without reason |
| G10 | P2 | Meta Q not scored as content | If meta slips in | Explicitly “not an interview question” |

---

## H. Report & results

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| H01 | P0 | End opens report | End Interview | Lands on report for **that** interview (auto-open) |
| H02 | P1 | Report generating state | Slow report gen | Loading/retry message; not blank forever |
| H03 | P0 | Exact project names in Ideal | G1 interview | Ideal uses “PDF Knowledge Chatbot” not “PDF converter” |
| H04 | P0 | No invented tools in Ideal | Don’t mention NLTK/NER | Ideal/Improved don’t invent NER/POS/test frameworks |
| H05 | P0 | Ideal ≠ Improved | Open any answered Q | Two different texts; Improved rewrites **candidate** answer |
| H06 | P1 | Improved keeps candidate story | Partial RAG answer | Improved keeps chunk→embed→retrieve idea |
| H07 | P1 | Summary vs scores | Compare overall vs per-Q average | Overall ≈ average; no inflation |
| H08 | P2 | Company readiness meaningful | Company selected | Company readiness can differ from overall |
| H09 | P2 | Practice next actionable | Read roadmap | Concrete next steps, not only fluff |
| H10 | P2 | Export/PDF if available | Download report | Opens; contains scores + Q feedback |
| H11 | P2 | Find latest interview | Complete 2 interviews | List shows both; latest easy to open |
| H12 | P0 | Meta Q in report | If process prompt appeared | Marked unscored / filtered — not normal 0/100 skill fail |
| H13 | P2 | Speaker name | Say name in intro | Report uses spoken name when detected |
| H14 | P2 | Strengths non-empty | Answer ≥3 Qs partially | ≥1 honest strength listed |

---

## I. Company / JD / personalization

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| I01 | P1 | No JD still works | Empty JD | Valid interview; resume-based |
| I02 | P1 | JD skills appear | JD lists Kubernetes | ≥1 related probe if resume/JD overlap allows |
| I03 | P1 | Amazon culture/ownership | Company=Amazon | ≥1 ownership/customer-style behavioral |
| I04 | P1 | TCS fundamentals flavor | Company=TCS | Fundamentals/delivery/communication style |
| I05 | P2 | Product vs service tone | Amazon vs TCS | Distinct emphasis |
| I06 | P2 | Research failure graceful | Block outbound web | Role-based fallback; no crash |
| I07 | P3 | Source quality (internal) | Check server logs/fields `companyQuestionSource` | verified / web_research / role_based set |

---

## J. Performance, scale & environment

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| J01 | P0 | 20 parallel starts | 20 users Start within 2 min | ≥90% sessions start; failures show clear errors |
| J02 | P0 | Rate limit behavior | Hammer speak/answer | Degrade gracefully; no crash loop |
| J03 | P1 | Create under load | Concurrent creates | <60s or timeout with message |
| J04 | P1 | Mongo down | Stop Mongo; load app | Clear DB error — not infinite spinner |
| J05 | P2 | API restart mid-session | Restart server; submit answer | Error + retry guidance |
| J06 | P0 | Node version | Run on Node 20 vs 22 | Document: Node 22 required; fail fast if wrong |
| J07 | P0 | Missing API keys | Empty GROQ key | Visible degraded mode — not “silent dumb interview” without notice |
| J08 | P1 | Offline blip | Disable network 5s during submit | Error; retry works when back |
| J09 | P2 | Large resume | 5+ page resume | Analysis completes <60s or warns |
| J10 | P3 | Long session memory | 45m interview | Tab stays responsive |

---

## K. Cross-browser / device / accessibility

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| K01 | P1 | Chrome baseline | Full path G1 | Pass P0 suite |
| K02 | P1 | Firefox | Full path | Core path works or documented gaps |
| K03 | P1 | Safari | Full path | Core path works or documented gaps |
| K04 | P2 | Edge | Smoke Start→End | No blocker |
| K05 | P2 | Mobile live layout | Phone 375px | Controls usable; Q readable |
| K06 | P2 | Mobile coding | Coding Q on phone | Usable or desktop recommendation |
| K07 | P3 | Keyboard navigation | Tab through Setup + controls | Focus visible; actionable |
| K08 | P3 | Screen reader smoke | NVDA/VoiceOver on Ready + one Q | Labels make sense |
| K09 | P2 | Theme toggle | Switch light/dark during setup/live | Readable; no missing text |

---

## L. Security / privacy / proctoring

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| L01 | P2 | Proctor disclosure | Read Ready tips | User knows cam/mic/focus expectations |
| L02 | P3 | Violation logging | Switch tab | No false “cheating fail” without policy |
| L03 | P2 | Authz isolation | User A must not open User B interview id | 401/403 |
| L04 | P2 | Resume privacy | Check no public resume URL without auth | Protected |
| L05 | P3 | Error leakage | Trigger 500 | No secret keys in client response |
| L06 | P3 | Token storage | Inspect localStorage | Expected auth pattern; no extra secrets |

---

## M. Data integrity & history

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| M01 | P1 | Double-click Start | Double-click Start Interview | One interview created (or second blocked) |
| M02 | P2 | Discard incomplete | Leave In Progress | Can abandon/resume intentionally |
| M03 | P1 | End retry | End once; refresh results | Single report; no duplicate corruption |
| M04 | P1 | State after API restart | Answer Q1; restart API; resume | State from Mongo consistent |
| M05 | P0 | Cross-user isolation | See L03 | Strict fail if broken |

---

## N. Messaging & product clarity

| ID | Severity | Title | Steps | Expected |
|----|----------|-------|-------|----------|
| N01 | P1 | Start failure message | Break create API | Actionable error (retry / check connection) |
| N02 | P1 | Distinguish failure causes | Mic deny vs API key vs network | Different messages |
| N03 | P2 | Coding run messaging | Run Python structural check | Does not claim “correct interview answer” |
| N04 | P2 | Closing wrap delay | End Interview | Spoken wrap OK; overlay explains saving |
| N05 | P3 | Help for first-timers | Look for guidance | Tips on Ready screen sufficient for first run |

---

## Smoke suite (run every build — 30 minutes)

| ID | Severity | Case |
|----|----------|------|
| S01 | P0 | Login → Upload G1 → Setup Amazon → Start |
| S02 | P0 | Hear intro + Tell me about yourself |
| S03 | P0 | Answer with mic; next Q plays |
| S04 | P0 | Discussion project Q has **no** coding UI |
| S05 | P0 | After 2 weak project answers, topic switches |
| S06 | P0 | End → report auto-opens |
| S07 | P0 | Ideal ≠ Improved; exact project name in Ideal |
| S08 | P0 | Refresh on Q3 resumes correctly |

---

## Execution tracker (copy per tester)

| Case ID | Tester | Browser | Result (Pass/Fail/Blocked) | Notes / Interview ID | Bug link |
|---------|--------|---------|----------------------------|----------------------|----------|
| | | | | | |

---

## Exit criteria (suggested)

- **All P0** smoke + section P0 cases Pass on Chrome.  
- **No open P0** defects.  
- **P1** defects either fixed or waived with written known-limitations sheet for testers/users.  
- Firefox/Safari: P0 path Pass or explicitly documented unsupported.  
- 20-user soak (J01/J02) completed once before release.
