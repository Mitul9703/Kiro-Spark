# Product Steering — Spark

## Product

**Spark** is an AI-powered rehearsal platform. Users practice high-pressure communication scenarios — interviews, pitches, presentations, coding rounds — against live AI avatars and receive a detailed performance report afterward.

The core insight: people often underperform not because they lack knowledge but because they have not trained for the _room_. Spark simulates the room.

## Primary user

A solo user preparing for a specific high-stakes session — an upcoming job interview, a pitch meeting, a defense, a coding round. They show up with materials (a deck, a resume, a company name) and want to rehearse against a realistic counterparty before the real thing.

## End-to-end user flow

1. Land on `/`, learn the product, click into agents.
2. Browse `/agents` — five role-specific agents: **Recruiter**, **Professor**, **Investor**, **Coding**, **Custom**.
3. Open an agent, create a _thread_ (a named practice goal that can hold multiple sessions).
4. In the thread page, optionally attach a PDF, paste a company URL, write custom context, then start a session.
5. Pre-session prep runs in the background: the system fetches relevant external context (company research, coding question, etc.).
6. The live session opens: the avatar appears, the user grants mic access, and a real-time voice conversation begins. Optional screen share for visual scenarios; an integrated code editor for coding rounds.
7. The user ends the session. In the background: per-session evaluation runs, then resource discovery, then thread-level evaluation if ≥2 sessions exist.
8. The user reads the session report — overall score, rubric breakdown, strengths, improvements, recommendations, transcript, comparison-to-previous-session — and the thread report tracks progress over time and produces _hidden guidance_ that steers the next session.

## Five role-specific agents

Each agent has its own system prompt, evaluation rubric, screen-share semantics, and external-research behavior.

| Slug        | Name             | Focus                                            | Screen share          | External research               |
| ----------- | ---------------- | ------------------------------------------------ | --------------------- | ------------------------------- |
| `recruiter` | Recruiter Loop   | Behavioral, impact, role fit                     | Yes                   | Yes (company)                   |
| `professor` | Academic Defense | Conceptual rigor, evidence, depth                | Yes                   | No                              |
| `investor`  | Investor Pitch   | Market, traction, differentiation, conviction    | Yes                   | Yes (company)                   |
| `coding`    | Coding Round     | Algorithmic reasoning, code clarity, think-aloud | No (uses code editor) | Yes (company-relevant question) |
| `custom`    | Custom Scenario  | Adaptable to any prompt                          | Yes                   | Yes (URL-driven)                |

## Success criteria

A build is "done" when, on a single Render web service, a fresh user can:

1. Open `/`, browse to `/agents`, pick the **Recruiter** agent, create a thread, upload a PDF, type a company URL, and start a session.
2. See the avatar render and lip-sync to a real Gemini Live voice; speak, hear the avatar reply with their words transcribed in the panel; share their screen and have the agent reference what is on it.
3. End the session and within ~30s see a structured evaluation appear with a 0–100 score, four rubric metrics with justifications, strengths, improvements, recommendations, and a list of resource briefs.
4. Open a second session in the same thread and see a thread-level evaluation appear that compares the two and produces hidden guidance for the next session.
5. Pick a baseline session and run a comparison and see metric deltas with insights.

The **Coding** agent must additionally render an in-browser code editor with syntax highlighting for JavaScript, Python, Java, C++, SQL, and Pseudocode, and must drive the conversation off a company-relevant interview question fetched at prep time.

## Non-goals (YAGNI)

- No user accounts, no auth, no cross-device sync. All state is per-browser.
- No database. Browser localStorage is the only persistence.
- No Docker, no Kubernetes. Single Render web service.
- No payment, no analytics, no admin dashboards.
- No automated test pyramid. Manual QA + per-endpoint smoke scripts only.
- No mobile native app. Desktop-first responsive web only.
