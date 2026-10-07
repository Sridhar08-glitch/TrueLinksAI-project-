<p align="center">
  <img src="frontend/public/logo-banner.png" alt="Sridhar — Software Developer" width="420" />
</p>

# Sridhar Property Intelligence — AI Lease Records & Issue Reporting

A full-stack service for a property owner, built around three linked AI agents:

1. **Lease Agent (Part A)** — reads an uploaded lease PDF, turns it into a structured, verifiable lease record, flags problems, and validates it against the owner's acceptance rules (`owner_ruleset.json`).
2. **Inspection Agent (Part B)** — looks at uploaded photos of a unit, assesses condition and visible equipment, and drafts a work order for the owner to review.
3. **Rules Agent** — reads the owner's written acceptance policy (PDF or text) and converts each requirement into a *proposed* rule — threshold updates, new template-based checks, or human-verified manual checks — which the owner approves or rejects one by one. Rules can also be bulk-imported from a ruleset JSON file.

The lease and inspection agents meet on a single **unit view**: open any apartment and you see its lease, its inspections, and its open work orders in one place. **Every AI output — every field, flag, rule result, and work order — can be accepted, rejected, or overridden by a human.** The AI proposes; a person decides.

---

## Table of contents

- [How the system works (big picture)](#how-the-system-works-big-picture)
- [Part A — The lease pipeline](#part-a--the-lease-pipeline)
- [Part B — The issue → work order pipeline](#part-b--the-issue--work-order-pipeline)
- [Roles & who can do what](#roles--who-can-do-what)
- [Traceability & human-in-the-loop](#traceability--human-in-the-loop)
- [AI provider architecture & API requirements](#ai-provider-architecture--api-requirements)
- [How to run it](#how-to-run-it)
- [API quick reference](#api-quick-reference)
- [Data model](#data-model)
- [Frontend architecture](#frontend-architecture)
- [Key decisions & trade-offs](#key-decisions--trade-offs)
- [What I left out (and why)](#what-i-left-out-and-why)
- [Where it breaks first at scale](#where-it-breaks-first-at-scale)
- [Product enhancement ideas](#product-enhancement-ideas)
- [Testing](#testing)
- [Repository layout](#repository-layout)

---

## How the system works (big picture)

```mermaid
flowchart LR
    subgraph Users
        O[Owner / Manager]
        T[Tenant / Inspector]
    end

    subgraph Frontend["React + TypeScript (Vite)"]
        UI[Leases · Units · Inspections · Work Orders]
    end

    subgraph Backend["Django + DRF (REST API /api/v1/)"]
        LA[Lease Agent]
        VA[Validation Engine<br/>R1–R7 + custom rules R8+]
        RA[Rules Agent<br/>policy document → proposed rules]
        IA[Inspection Agent<br/>vision analysis]
        WO[Work Order Generator]
        AU[Audit Log]
    end

    subgraph AI["AI Providers (pluggable)"]
        LLM[Text model<br/>Ollama llama3.2 / mock]
        VLM[Vision model<br/>Ollama llava / mock]
    end

    DB[(PostgreSQL)]
    RULES[/"sample_data/owner_ruleset.json<br/>sample_data/units.json"/]

    O --> UI
    T --> UI
    UI --> Backend
    LA --> LLM
    RA --> LLM
    IA --> VLM
    VA --> RULES
    RA --> RULES
    LA --> VA
    IA --> WO
    Backend --> DB
    Backend --> AU
```

**Stack:** Django 5 + Django REST Framework, PostgreSQL, React 19 + TypeScript + Vite, PyMuPDF for PDF text extraction, Ollama for local AI (with a deterministic mock provider so the app runs with **no AI at all**). JWT auth with role-based permissions (owner / manager / technician / tenant).

---

## Part A — The lease pipeline

What happens when an owner uploads a lease PDF:

```mermaid
flowchart TD
    A[1 · Owner uploads lease PDF] --> B[2 · PyMuPDF extracts text, page by page]
    B --> C[3 · AI provider extracts structured fields<br/>parties · unit · dates · rent + frequency ·<br/>deposit · escalation · renewal · termination]
    C --> D["4 · Every field is stored WITH its evidence:<br/>source page + source quote + confidence score"]
    D --> E[5 · Flagging service finds problems<br/>missing fields · impossible dates ·<br/>suspicious rent · contradictions · vague clauses]
    E --> F["6 · Validation engine runs R1–R7<br/>(loaded from owner_ruleset.json)<br/>each rule → PASS / FAIL / UNDETERMINED + reason"]
    F --> G[7 · Unit matcher links the lease<br/>to its unit in units.json data]
    G --> H{8 · Human review}
    H -->|approve / reject each field| H
    H -->|resolve / dismiss each flag| H
    H -->|override a failed rule, with reason| H
    H -->|Approve lease| I[9 · Unit marked OCCUPIED<br/>payment schedule generated]
    H -->|Reject lease| J[Unit stays / returns to AVAILABLE]
```

Key behaviors:

- **Nothing is invented.** If the document doesn't contain a value, the field is stored as `NOT_FOUND` and flagged — the AI is instructed (and the mock provider is built) to never fabricate.
- **UNDETERMINED is a first-class answer.** If a rule can't be decided from the document (e.g., signatures can't be detected from text alone), the system says so and hands the call to a human, rather than guessing.
- **Everything re-runs safely.** Re-processing a lease clears and regenerates its fields, flags, and validations inside one atomic transaction.

### The 7 owner rules (from `sample_data/owner_ruleset.json`)

| Rule | What it checks | Severity |
|------|----------------|----------|
| R1 | Deposit ≥ one month's rent | high |
| R2 | Escalation clause is actually defined (not "as mutually agreed") | medium |
| R3 | Fixed term ≤ 36 months | medium |
| R4 | Expiry after commencement; term matches the dates | high |
| R5 | Both parties identified and signed | high |
| R6 | Annual rent = monthly rent × 12 | low |
| R7 | Unit exists in the owner's records and is available | high |

The rule **definitions** (description, check, severity) are loaded from the JSON file at startup, so the owner's file is the source of truth for what the rules say; the **evaluation logic** for each rule is versioned in code (`validation_engine.py`), where it can be tested. If the file is missing, built-in definitions keep the app working.

**The owner can edit the rules from the portal.** The owner sidebar has a **Lease Rules** page where each rule's description, severity, on/off switch, and numeric thresholds (minimum deposit months, maximum term, rent tolerance %) can be changed — edits are validated, written back to `owner_ruleset.json` atomically, restricted to the owner role, and audit-logged. The check *logic* is deliberately not editable from the UI (no user-supplied expressions are ever executed). Rule changes apply to every lease processed afterwards; already-reviewed leases keep their recorded results, and a **Re-validate** button on any lease re-runs the current rules against its extracted fields without re-running the AI.

**The owner can also create new rules (R8, R9, …)** from eight safe templates — field vs number, field vs field × factor, required field, date order, text must/must-not contain, lease term length, allowed values, and **manual check**. A manual-check rule covers requirements no automated check can express ("tenant must provide a no-objection certificate"): it evaluates UNDETERMINED on every lease, scans the document for related wording and quotes it as evidence on the validation card, and requires a human override to resolve — the system enforces that the question gets asked.

**And rules can be imported from documents (the Rules Agent).** On the same page the owner can upload a ruleset JSON (bulk threshold updates, with unknown rules reported back — never executed) or a written policy document (PDF/text, try `sample_data/owner_policy_sample.pdf`). The AI converts each statement into a proposal with its source sentence quoted; a deterministic pattern-matcher backstops the model, so a weak local model degrades to regex mapping — never to a lost rule. Provider output is forced onto a whitelist of templates, fields, and operators (structured data only, never code), and each proposal is individually approved or rejected by the owner, audit-logged.

```mermaid
flowchart TD
    A[1 · Owner uploads their written policy<br/>PDF / text — or a ruleset JSON] --> B{File type}
    B -->|ruleset JSON| C["Validated bulk update of R1–R7 thresholds<br/>(unknown rules reported back, never executed)"]
    B -->|policy document| D[2 · AI reads each policy statement]
    D --> E["3 · Whitelist sanitizer:<br/>only known templates · fields · operators survive<br/>(nothing from the document is ever executed)"]
    E -->|statement the model failed to map| F[4 · Deterministic pattern matcher<br/>retries the source sentence]
    F --> G
    E --> G["5 · Proposals, each quoting its source sentence:<br/>threshold update · new rule R8+ ·<br/>manual check (human verifies per lease)"]
    G --> H{6 · Owner reviews each proposal}
    H -->|approve| I[Threshold changed or rule created<br/>runs on every lease from now on]
    H -->|reject with reason| J[Recorded, nothing changes]
    I --> K[Every upload and decision audit-logged]
    J --> K
```

---

## Part B — The issue → work order pipeline

What happens when a tenant or inspector reports a problem:

```mermaid
flowchart TD
    A[1 · Tenant/inspector uploads one or more photos of the unit] --> B[2 · Vision provider analyses each photo]
    B --> C["3 · Findings stored per photo:<br/>equipment seen (AC, water heater, appliances, fixtures) ·<br/>condition (good / fair / poor / critical) ·<br/>damage description · confidence"]
    C --> D["4 · Work order generator drafts a work order:<br/>short title · what's wrong · affected unit<br/>status = DRAFT"]
    D --> E{5 · Owner reviews}
    E -->|Approve| F[Work order moves to APPROVED<br/>can be assigned to a technician]
    E -->|Reject with reason| G[Work order REJECTED<br/>reason kept on record]
    F --> H[Everything visible on the unit's page,<br/>next to its lease]
    G --> H
```

- Vision findings use **evidence-bounded language** — the model describes what is visible, with a confidence score, and tests enforce that it doesn't make damage claims without evidence.
- Work orders follow a simple state machine (`DRAFT → PENDING_APPROVAL → APPROVED / REJECTED`), and every transition is written to the audit log with who did it and when.

### Bringing A and B together

Open any unit (Units page → click a unit) and the **unit overview** shows, in one drawer: the unit's details, its active lease, pending leases, recent inspections with finding counts, and its work orders. This is the owner's single pane of glass per apartment.

---

## Roles & who can do what

Four roles with deliberately different powers. Where this README says "the owner" for review actions, read "owner or property manager" — day-to-day review is fully delegated to managers; only the acceptance policy and account management stay owner-only.

| Action | Owner | Manager | Technician | Tenant |
|--------|:---:|:---:|:---:|:---:|
| Review lease fields / flags / clauses, approve or reject leases | ✅ | ✅ | — | — |
| Override rule results (reason required, audit-logged) | ✅ | ✅ | — | — |
| Approve / reject work orders | ✅ | ✅ | — | — |
| Edit rules, create custom rules, decide rule proposals | ✅ | view only | — | — |
| Create / deactivate staff accounts, invite tenants | ✅ | — | — | — |
| Start / complete assigned work orders, run verification | — | — | ✅ | — |
| Report issues with photos, track status, view own documents | — | — | — | ✅ |

Every action is audit-logged under the actor's own name, so the owner can always distinguish their decisions from a manager's.

---

## Traceability & human-in-the-loop

This was the core design constraint: *a wrong rent, date, or condition call is a real cost to someone*, so no AI output is ever final on its own.

| AI output | Evidence attached | Human controls |
|-----------|-------------------|----------------|
| Extracted lease field | source page, source quote, confidence % | approve / reject (with reason) per field; bulk-approve pending; override value |
| Problem flag | severity, related fields, source reference | acknowledge / resolve / dismiss, with reviewer comment |
| Rule result (R1–R7) | reason, evaluated values, rule text from ruleset | **override** a FAIL/UNDETERMINED with a mandatory written reason; undo override |
| Draft work order | per-photo findings, confidence, damage description | approve / reject with reason |
| Lease itself | all of the above | approve (marks unit occupied) / reject / cancel |

Every one of these decisions is recorded in an **audit log** (`apps/audit`): entity, action, actor, previous value, new value, timestamp. If a lease with a failed deposit rule got approved, you can answer *who overrode R1, when, and why* — months later.

---

## AI provider architecture & API requirements

The models are **stubbed behind interfaces**, exactly so you can run the app with your own API (or none at all).

```mermaid
flowchart LR
    S[LeaseExtractionService] --> I1{{LeaseExtractionProvider<br/>interface}}
    V[InspectionAnalysisService] --> I2{{Vision provider<br/>interface}}
    I1 --> M1[MockProvider<br/>regex-based, deterministic,<br/>no AI needed]
    I1 --> O1[OllamaProvider<br/>local llama3.2, JSON mode]
    I1 --> A1[OpenAI-compatible provider<br/>any hosted API — config only]
    I1 -.-> Y1[Your provider<br/>any other LLM API]
    I2 --> M2[MockVisionProvider<br/>scenario-based]
    I2 --> O2[OllamaVisionProvider<br/>local llava:7b]
    I2 --> A2[OpenAI-compatible vision<br/>config only]
    I2 -.-> Y2[Your vision provider]
```

Three ways to run it:

| Mode | Set | What you need |
|------|-----|---------------|
| **No AI (quickest to evaluate)** | `AI_PROVIDER=mock` | Nothing. The mock text provider extracts fields deterministically from the sample lease; the mock vision provider returns realistic findings; the mock policy provider parses rule statements with patterns. The whole pipeline — provenance, flags, rules, rule import, review, work orders — works end-to-end. |
| **Local AI (how I developed it)** | `AI_PROVIDER=ollama` | [Ollama](https://ollama.com) running on `localhost:11434` with `ollama pull llama3.2` and `ollama pull llava:7b`. No API key, fully offline. |
| **Your API (no code needed)** | `AI_PROVIDER=openai` | Any OpenAI-compatible chat-completions API — OpenAI, Groq, Together, Azure, or even Ollama's own `/v1`. Set `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` (text, must support JSON output), and `OPENAI_VISION_MODEL` (for photo analysis) in `.env`. All four AI features — lease extraction, inspection vision, the Rules Agent, and lease Q&A — run through it with the same prompts, provenance backfill, and whitelist safety as the local providers. |
| **A non-OpenAI-shaped API** | implement a provider | Subclass `LeaseExtractionProvider` (`backend/apps/lease_agent/services/providers/base.py`) — one method, `extract(document_text, pages) → ExtractionResult` — and the vision equivalent in `backend/apps/inspections/services/`. Register it in the provider factories. Model requirements: a text model that returns structured JSON (field, value, source page, confidence) and a vision model that describes equipment/condition in JSON. Temperature 0 recommended. |

Environment variables (backend `.env`):

```env
DATABASE_URL=postgresql://truelinks:holora@localhost:5432/truelinks_db
AI_PROVIDER=ollama            # or: mock | openai

# ollama mode
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_VISION_MODEL=llava:7b

# openai mode — any OpenAI-compatible API
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_VISION_MODEL=gpt-4o-mini
```

---

## How to run it

### Option 1 — One-click on Windows (`setup.bat` + `start.bat`)

**First time: double-click `setup.bat`.** It walks through seven steps, printing progress for each:

1. Checks for **Python**, **Node.js**, and **PostgreSQL** — anything missing is installed via winget (if it installs Python or Node, it asks you to re-run setup.bat once so the new PATH is picked up).
2. Creates the app database. On a machine where PostgreSQL was just installed, it asks once for the `postgres` superuser password to create the `truelinks` role and `truelinks_db` — if the database already exists, this is skipped entirely.
3. Detects **Ollama**: if it's running (or installable), the models `llama3.2:3b` and `llava:7b` are pulled if missing, and the app is configured for local AI. If Ollama isn't available, the app is configured for the **mock provider** instead — everything still works, no AI setup required.
4. Sets up the backend: virtualenv, dependencies, **creates `backend/.env` automatically** with the right values for this machine (if a `.env` already exists, only the AI settings are refreshed), runs migrations, seeds the sample units, and creates the four demo users.
5. Installs frontend packages.

`setup.bat` is idempotent — safe to run again at any time; it skips whatever is already done.

**Every time after that: double-click `start.bat`.** It applies any pending database migrations, opens two terminal windows (backend on :8000, frontend on :5173), waits until the backend actually responds, then opens the app in your browser. To stop the app, close those two windows.

### Option 2 — Manual setup

### Prerequisites

- Python 3.12+, Node 18+, PostgreSQL 16 (a `docker-compose.yml` is included that runs **only** Postgres, if you prefer: `docker compose up -d db`)
- Optional: Ollama with `llama3.2` and `llava:7b` (skip entirely with `AI_PROVIDER=mock`)

### 1 · Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows   (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt

# create .env — copy backend/.env.example and adjust (see variables above), then:
python manage.py migrate
python manage.py seed_sample_data      # loads sample_data/units.json → properties, buildings, units
python manage.py ensure_demo_users     # creates the demo logins below
python manage.py runserver 0.0.0.0:8000
```

### 2 · Frontend

```bash
cd frontend
npm install
npm run dev        # → http://localhost:5173
```

### 3 · Try the demo flow

| Role | Email | Password |
|------|-------|----------|
| Owner | `owner@truelinks.com` | `Owner@12345` |
| Manager | `manager@truelinks.com` | `Manager@12345` |
| Technician | `tech@truelinks.com` | `Tech@12345` |
| Tenant | `tenant@truelinks.com` | `Tenant@12345` |

1. Log in as **owner** → Leases → *Add Lease* → upload `sample_data/leases/sample_lease_MC-B-1204.pdf` → watch extraction run.
2. Open the lease → **Extracted Fields** tab: every value with its page + quote; approve or reject each one.
3. **AI Review** tab: flags and the R1–R7 scorecard, sorted by severity; override a failing rule (a reason is required and audit-logged).
4. Approve the lease → unit `MC-B-1204` flips to *occupied* and a payment schedule is generated.
5. Log in as **tenant** → report a maintenance issue with photos (use `sample_data/photos/` — a leaking pipe and a water-damaged ceiling) → log back in as owner → review the AI findings and the **draft work order**; approve or reject it.
6. Units page → click the unit → see lease + inspections + work orders together.
7. Lease Rules page → **Upload policy document (AI)** → pick `sample_data/owner_policy_sample.pdf` (15 policy statements) → watch the Rules Agent turn them into proposals, each quoting its source sentence → approve a few and re-validate a lease to see them run.
8. Open a lease → **Ask AI** tab → ask "Are pets allowed?" or "Which rules did not pass and why?" — answers come from the full verified record, not just the raw text.

API docs (Swagger) are served at `http://localhost:8000/api/docs/`.

> Want the guided tour? **[WALKTHROUGHS.md](WALKTHROUGHS.md)** walks every role through every workflow step by step — owner (lease pipeline, rules & the Rules Agent, Ask AI, work orders, unit view, staff, payments, audit), manager (and what they deliberately can't do), technician (start → complete → before/after verification), and tenant (report with photos → tracked notifications). API-level references per role are in `OWNER_WORKFLOW.md`, `STAFF_WORKFLOW.md`, and `TENANT_WORKFLOW.md`.

> Need a second test lease? `backend/create_sample_lease.py` generates one, and you can edit its text to deliberately break rules (e.g., set the deposit below one month's rent) to watch R1 fail.

---

## API quick reference

All endpoints under `/api/v1/`, JWT-authenticated, role-gated.

| Area | Endpoint (selection) | Purpose |
|------|----------------------|---------|
| Leases | `POST /leases/upload/` · `POST /leases/{id}/process/` | upload PDF, run AI extraction |
| | `GET /leases/{id}/fields|flags|validations|clauses/` | review data with provenance |
| | `POST /leases/{id}/approve|reject|cancel/` | lease decision → updates unit occupancy |
| Field review | `POST /lease-fields/{id}/approve|reject/` · `POST /lease-fields/bulk-approve/` | per-field human decisions |
| Flags | `POST /lease-flags/{id}/review/` | acknowledge / resolve / dismiss |
| Rules | `POST /validations/{id}/override/` · `.../clear-override/` | per-rule override with reason (audit-logged) |
| | `GET/PATCH /lease-rules/` · `POST /lease-rules/import/` | view/edit the ruleset; bulk-import a ruleset JSON |
| | `POST /custom-rules/` · `GET /custom-rules/options/` | owner-created rules (R8+) from 8 safe templates |
| Rules Agent | `POST /rule-proposals/upload/` · `POST /rule-proposals/{id}/approve\|reject/` | policy document → proposed rules → human decision |
| Ask AI | `POST /leases/{id}/ask/` | Q&A over the full lease record: fields, rules, flags, clauses, overrides, document text |
| Inspections | `POST /inspections/` · `POST /inspections/{id}/images/` | report issue with photos, triggers vision analysis |
| Work orders | `POST /work-orders/{id}/approve|reject/` | owner decision on drafts |
| Units | `GET /units/{id}/overview/` | the combined unit view (lease + inspections + work orders) |
| Audit | `GET /audit-events/` | who did what, when |

---

## Data model

Simplified — the tables that carry the core story:

```mermaid
erDiagram
    PROPERTY ||--o{ BUILDING : contains
    BUILDING ||--o{ UNIT : contains
    UNIT ||--o{ LEASE : "leased by"
    LEASE ||--o{ LEASE_FIELD : "extracted fields (with source page/quote/confidence + review status)"
    LEASE ||--o{ LEASE_FLAG : "problems for a human to check"
    LEASE ||--o{ VALIDATION_RESULT : "R1–R7 results (severity + override)"
    LEASE ||--o{ LEASE_CLAUSE : "dynamically discovered clauses"
    UNIT ||--o{ INSPECTION : "issues reported against"
    INSPECTION ||--o{ INSPECTION_IMAGE : photos
    INSPECTION ||--o{ INSPECTION_FINDING : "equipment + condition + damage"
    INSPECTION ||--o{ WORK_ORDER : "drafts generated from"
    LEASE ||--o{ PAYMENT : "schedule on approval"
    AUDIT_EVENT }o--|| LEASE : "logs decisions on"
```

The unit is the hub: leases attach to it from Part A, inspections and work orders attach to it from Part B, and the unit overview endpoint joins them.

---

## Frontend architecture

React 19 + TypeScript on Vite 8, styled with Tailwind CSS 4. The structure mirrors the roles the backend enforces.

**Role-based app shells.** `App.tsx` renders a different route tree per role: the owner gets the full sidebar (Dashboard, Properties, Buildings, Units, Tenants, Staff, Leases, Lease Rules, Work Orders, Inspections, Payments, Reports, Audit), the manager gets the same minus Staff and with Lease Rules read-only, the technician gets a maintenance-only shell, and tenants get their own portal (`TenantLayout`: home, maintenance, documents, notifications). Unknown routes redirect to the role's home — a tenant can't even *render* an owner page, and the backend enforces the same boundary with 403s.

**Server state via TanStack React Query.** All API data flows through queries with explicit cache keys; mutations invalidate exactly the keys they affect. Long-running AI work is handled by polling — the lease list re-fetches while anything is processing, and the rule-proposals list polls so results appear even if the triggering browser request was interrupted. Session state (JWT, current user) lives in a small Zustand store; forms use react-hook-form + zod.

**One API client** (`src/lib/api.ts`): an axios instance that attaches the JWT on every request, auto-refreshes on 401 (with a queue so concurrent 401s trigger a single refresh), and applies per-endpoint timeout overrides where local AI needs minutes rather than the 30-second default. In development, Vite proxies `/api` to the backend — the frontend needs zero configuration to run.

**AI-latency UX.** Anything that waits on a model says so: upload dialogs show processing states, the policy import shows an "AI is reading your document…" banner with a spinner, and lists keep polling so users never refresh manually. Errors surface as toasts with the backend's actual message rather than a generic failure.

**UI kit.** A small in-house component set (`components/ui`: Button, Card, Badge, StatCard, Toast, QueryError, EmptyState, LoadingSpinner…) keeps the 23 pages visually consistent without a heavyweight component library; icons are lucide-react, charts are recharts. `npm run build` type-checks the entire app (`tsc -b`), `npm run lint` runs oxlint.

---

## Key decisions & trade-offs

**Evidence-first extraction schema.** Each extracted field is a row (`LeaseField`) with `source_page`, `source_text`, `confidence`, and its own `review_status` — not a blob of JSON on the lease. More rows, but it's what makes per-field approve/reject, provenance display, and audit possible. The brief's "traceable and overridable" requirement drove the schema.

**Rules: definitions in data, logic in code.** The validation engine loads rule descriptions, check conditions, and severities from `owner_ruleset.json` (the owner's file is the source of truth for *what the rules say*), while each rule's evaluation lives in a tested Python method (*how it's checked*). A fully generic rule interpreter (eval-ing check expressions from JSON) would allow new rules without deploys, but is an injection risk and much harder to test — wrong trade for 7 rules. If the file is absent the engine falls back to built-in definitions, so a missing file can't take the product down.

**UNDETERMINED over false confidence.** Rules and extraction both prefer "can't tell, human needed" to a guess. R5 (signatures) is the clearest case: text extraction can't reliably prove a signature, so it returns UNDETERMINED instead of a fake PASS.

**Local-first AI with a hard mock fallback.** Ollama means no API keys, no cost, no data leaving the machine — right for a take-home and for privacy-sensitive lease documents. The mock provider isn't a toy: it's deterministic, used by the test suite, and lets a reviewer evaluate the entire product with zero AI setup.

**Synchronous-ish processing on daemon threads, no task queue.** AI jobs run on background threads with a 10-minute stuck-state reclaim, instead of Celery + Redis. Two fewer moving parts for an evaluator to install; the first thing I'd replace in production (see scale section).

**Monolith + modular Django apps.** `leases`, `lease_agent`, `inspections`, `work_orders`, `units`, `validation`, `audit` are separate apps with service-layer boundaries (views stay thin; pipeline logic lives in services). That keeps a future extraction into separate services realistic without paying the microservice tax today.

**Default currency QAR**, matching the Doha-based sample data.

## What I left out (and why)

- **Multi-owner tenancy.** Everything assumes one ownership entity (as the sample data does). Real multi-org support (an `owner` FK on Property + queryset scoping everywhere) is a deliberate, separate project — bolting it on quickly risks data-leak bugs, the worst kind.
- **OCR for scanned leases.** PyMuPDF reads digital PDFs; a scanned/photographed lease needs an OCR step (or a vision-model page reader) in front of the same pipeline.
- **Real payment collection.** A payment schedule is generated on approval, but no gateway integration (needs real credentials).
- **Notifications.** Emails print to the console; no push/SMS when a work order is approved or rent is late.
- **Celery/queue, S3 media, deployment manifests** — intentionally skipped to keep the reviewer's setup small; called out below as the first scale fixes.

## Where it breaks first at scale

In the order I'd expect it to hurt:

1. **AI jobs on in-process threads.** At tens of concurrent uploads, extraction competes with the web server for CPU; a process restart loses in-flight jobs (the 10-min reclaim recovers state, but slowly). **Fix:** Celery/RQ workers + Redis; jobs become retryable and horizontally scalable.
2. **Ollama itself.** A single local model instance is the throughput ceiling and a single point of failure. **Fix:** the provider interface makes this a config change — point at a hosted model API or a load-balanced model server, add per-provider rate limiting and retry with backoff.
3. **Unit overview and list endpoints** are fine at hundreds of units but will need pagination-by-default, tighter `select_related`/`prefetch_related`, and caching at thousands of units with years of inspection history.
4. **Media on local disk.** Photos and PDFs go to the Django media folder (signed URLs, 1-hour expiry). **Fix:** S3-compatible storage with presigned URLs; the signing layer already abstracts this.
5. **Frontend bundle (~1.3 MB)** needs route-based code splitting before the team grows the surface area further.
6. **Audit table growth** — append-only and unbounded; needs partitioning/archival after a year or two of real usage.

---

## Product enhancement ideas

Where I would take this next if I owned it — grouped by who it helps. These are the near-term ideas that build directly on what's shipped; the full product vision — 122 feature, experience, and business-model ideas with a sequencing strategy — is in **[FUTURE_IMPROVEMENTS.md](FUTURE_IMPROVEMENTS.md)**.

### For the owner (decision quality & money)

1. **Lease renewal radar.** The data already knows every end date. A dashboard lane: "expiring in 90/60/30 days", one-click renewal offer generation using the lease's own escalation clause, flagging below-market rents (vs. the owner's other units of the same type).
2. **Portfolio rule analytics.** R1–R7 results aggregated across the portfolio: "R2 (escalation) fails in 40% of leases from agent X" — turns the ruleset from a per-lease gate into a negotiation-improvement tool.
3. **Cost intelligence on work orders.** Attach actual repair costs to work orders, then surface per-unit maintenance spend and per-equipment failure rates ("this AC brand fails 3× more often") to drive purchasing decisions.
4. **Deposit & compliance ledger.** Track deposit held vs. deductions vs. returned, tied to move-out inspection findings — the single most disputed number in any tenancy.

### For the tenant & the maintenance team (loop closure)

5. **Status-visible issue tracking.** Tenants see their report move through *received → approved → technician assigned → fixed*, with photos of the completed repair. Most property-management friction is silence, not slowness.
6. **Before/after photo verification.** A technician closes a work order with photos; the same vision agent compares against the original findings and flags "damage still visible" before the owner is told it's done.
7. **Scheduled recurring inspections** (quarterly AC service, annual deep inspection) auto-generating inspection requests — the models for schedules already exist.

### For the product (AI depth)

8. **Clause-risk library.** Beyond the 7 rules: a growing library of risky-clause patterns (automatic renewal traps, one-sided termination, missing maintenance responsibility) with owner-configurable severity — the dynamic clause discovery already extracts the raw material.
9. **Cross-document contradiction checks.** Validate a new lease against the *previous* lease on the same unit and against reality: "rent dropped 30% vs. last tenant — intended?"
10. **Move-in/move-out baseline.** Vision analysis of move-in photos becomes the unit's condition baseline; move-out photos are diffed against it to produce an evidence-backed deposit deduction report — connecting Part A and Part B into one financial story.
11. **Owner Q&A across the portfolio.** The per-lease "Ask AI" becomes portfolio-wide: "Which leases let me terminate with 60 days' notice?" — answerable because every clause is stored with provenance.

If I had one more week, I'd build #1 (renewal radar) and #5 (tenant status visibility): both reuse existing data, and together they touch the two moments — renewal and repair — where an owner actually feels the product.

---

## Testing

```bash
cd backend
.venv\Scripts\python.exe -m pytest        # 223 tests
```

Coverage focuses on the risky parts: extraction accuracy against known documents, the dynamic-field path, vision-provider behavior (evidence-bounded language, confidence bounds, no unsupported damage claims), work-order generation and its approval state machine, validation rules, custom-rule templates, and the Rules Agent (policy statement mapping, whitelist sanitization — including recovery from malformed model output such as merged rule targets and non-numeric thresholds — and the approve/reject flow). Frontend: `npm run build` type-checks the full app.

## Repository layout

```
backend/
  apps/
    lease_agent/     # Part A pipeline: PDF → fields → flags → validation (providers/ = AI interface)
    leases/          # lease, field, flag, clause models + review endpoints + Ask AI
    validation/      # rule results, overrides, custom rules, Rules Agent (services/policy_import.py)
    inspections/     # Part B: photos → vision findings (incl. vision providers)
    work_orders/     # draft generation + approval state machine
    units/ properties/  # portfolio structure, occupancy, unit overview
    payments/        # schedule generation on lease approval
    users/           # JWT auth, roles, invitations
    audit/           # append-only decision log
  tests/             # pytest suite
frontend/
  src/pages/         # Leases, Units, Inspections, WorkOrders, tenant portal…
  src/components/    # incl. UnitOverviewDrawer (the combined unit view)
sample_data/
  units.json               # the owner's unit records (provided)
  owner_ruleset.json       # the owner's 7 acceptance rules (provided)
  owner_policy_sample.pdf  # 15-statement policy document for testing the Rules Agent
  leases/                  # sample lease PDFs created for testing (the brief provides no documents)
  photos/                  # sample inspection photos (leaking pipe, water-damaged ceiling)
docker-compose.yml   # Postgres only — app runs natively
```

---

## Author

<a href="https://github.com/Sridhar08-glitch">
  <img src="https://github.com/Sridhar08-glitch.png?size=100" alt="Sridhar Mahalingam" width="90" style="border-radius: 50%" />
</a>

**Sridhar Mahalingam**
[![GitHub](https://img.shields.io/badge/GitHub-Sridhar08--glitch-181717?logo=github)](https://github.com/Sridhar08-glitch)
[![Followers](https://img.shields.io/github/followers/Sridhar08-glitch?label=followers&style=flat)](https://github.com/Sridhar08-glitch?tab=followers)


