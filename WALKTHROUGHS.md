# Walkthroughs — how every workflow actually runs

Step-by-step tours of the system, one per workflow, written the way you'd demo them — every click spelled out, with what you should see after each step.

## Before you start

1. Make sure the app is running: double-click `start.bat` (or follow the manual steps in the README). Two terminal windows open — backend and frontend — and the browser opens `http://localhost:5173` by itself. If it doesn't, open that address manually.
2. You land on the **login page**: an email field, a password field, and a **Sign in** button.
3. Use these demo accounts (created automatically by `setup.bat` / `manage.py ensure_demo_users`):

| Role | Email | Password | After login you land on |
|------|-------|----------|------------------------|
| Owner | `owner@truelinks.com` | `Owner@12345` | Owner dashboard, full sidebar |
| Manager | `manager@truelinks.com` | `Manager@12345` | Same dashboard, reduced powers |
| Technician | `tech@truelinks.com` | `Tech@12345` | Maintenance dashboard |
| Tenant | `tenant@truelinks.com` | `Tenant@12345` | Tenant portal |

4. **Switching roles:** log out from the profile/account menu, or simpler for demos — open a second browser profile or a private/incognito window and log in as the other role there, so you can watch both sides at once (e.g. tenant reports, owner reviews).
5. Local AI note: anything marked **[AI step]** calls Ollama and takes from a few seconds up to 1–2 minutes on CPU. The pages poll by themselves — you never need to refresh manually.

---

## OWNER

Log in with `owner@truelinks.com` / `Owner@12345`. The sidebar is the map for everything below: Dashboard, Properties, Buildings, Units, Tenants, Staff, Leases, Lease Rules, Work Orders, Inspections, Payments, Reports, Audit, Notifications, Settings.

### 1 · Process a lease from PDF to approved — the core Part A flow

1. After login you're on the **Dashboard** — occupancy, pending leases, open work orders, recent activity. This is the portfolio at a glance; everything on it is clickable.
2. Click **Leases** in the sidebar. You see the list of lease documents with their processing status and approval status.
3. Click the **Add Lease** button (top right). A dialog opens offering two paths: **Upload PDF** (the AI path) or **manual entry**. Choose Upload PDF.
4. Drag the file into the drop zone or click it to browse. Pick `sample_data/leases/sample_residential_lease_qatar.pdf` from the project folder. Click **Upload & Extract**.
5. **[AI step]** The dialog closes and the lease appears in the list as *processing*. Wait — the list updates by itself. When it shows *completed*, click the lease to open it.
6. The lease detail opens on the **Overview** tab: tenant, landlord, unit, dates, rent, deposit, all filled in by the AI. Notice the unit was matched automatically (the lease names MC-B-1204, and that unit exists in the seeded records).
7. Click the **Extracted Fields** tab. Every field is a card showing three things that matter:
   - the **value** the AI extracted,
   - the **evidence**: source page and the exact quote from the document it came from,
   - a **confidence** percentage.
   Fields the document doesn't contain show `NOT_FOUND` at confidence 0 — the AI is built to never invent a value. The signature fields are the usual example.
8. Review each field: click **Approve** on correct ones, **Reject** on wrong ones (a reason box appears — type why, e.g. "date misread"). For speed, use **bulk approve** for all the obviously-correct pending fields. Each click is recorded in the audit log with your name.
9. Click the **AI Review** tab. Two sections:
   - **Flags** — problems the system wants a human to see (missing fields, contradictions, suspicious values), sorted by severity. Open one, pick **acknowledge**, **resolve**, or **dismiss**, and add a comment.
   - **The rule scorecard** — R1–R7 plus any custom rules you've created, each showing **PASS / FAIL / UNDETERMINED** with a written reason, e.g. *"Deposit (7500.0) is >= required minimum (7500.0, 1 month(s) of rent)."* UNDETERMINED means the document couldn't prove it either way — the system hands the call to you instead of guessing. R5 (signatures) is the classic case: text extraction can't prove a signature, so it asks a human.
10. If a rule shows FAIL but you want to accept the lease anyway: click **Override** on that rule card. A reason is **mandatory** — type it (e.g. "Owner accepts 1-month deposit; guarantor provided") and confirm. The rule card now shows it's overridden, by whom, and why. Clear the override any time.
11. Back on the lease, click **Approve Lease**. Three things happen at once:
    - the unit flips to *occupied* (check the Units page),
    - a **payment schedule** is generated — open the lease's **Payments** tab to see the installments,
    - the approval lands in the audit log.
    Rejecting instead asks for a reason, keeps the unit available, and records the decision.

### 2 · Teach the system your rules — thresholds, custom rules, and the Rules Agent

1. Click **Lease Rules** in the sidebar. The page has three areas, top to bottom: the built-in rules R1–R7, **Import Rules**, and **Your Custom Rules**.
2. **Edit a threshold.** On the R1 card, change *Minimum deposit (months of rent)* from `1` to `2` and click **Save**. The change is written to `owner_ruleset.json` and audit-logged.
3. **See the rule re-judge a lease.** Open any processed lease → **AI Review** tab → click **Re-validate**. The rules re-run instantly against the already-extracted fields (no AI call). R1 now shows FAIL — the deposit is only one month. Go back, set R1 to `1` again, re-validate: PASS again. Rules are data; judgments are repeatable.
4. **Build a custom rule by hand.** Under **Your Custom Rules**, click **New Rule**. Pick a rule type from the dropdown (eight templates: compare a field to a number, field to field, required field, date order, text must/must-not contain, lease term length, allowed values, manual check). Example: type = *Field compared to a number*, field = *Monthly rent*, condition = *at least*, value = `3000`, severity = high, description = "Monthly rent must be at least QAR 3,000". Click **Create rule**. It becomes **R8** and runs on every lease from now on.
5. **Import rules from your policy document [AI step].** In **Import Rules**, click **Upload policy document (AI)** and pick `sample_data/owner_policy_sample.pdf` (a one-page policy with 15 numbered statements). A blue banner with a spinner appears: *"AI is reading your policy document…"*. Leave the page open — this takes a minute or two locally; the proposals appear below by themselves.
6. **Review the proposal cards.** Each card quotes **the exact sentence of your policy it came from**, plus what it wants to do:
   - blue **"Update built-in rule"** cards — e.g. *"Set minimum deposit (months of rent) to 2 → R1"*;
   - blue **"New custom rule"** cards — e.g. *"Monthly rent must be at least 3500"*, mapped onto a template;
   - amber **"Manual check rule"** cards — statements no automated check can express (a no-objection certificate, a pets policy). These are still approvable: approving creates a rule that asks a human to verify the requirement on every lease.
7. Click **Approve** on a card: a threshold update changes R1–R7 immediately; a custom-rule card creates the R8+ rule and it appears in **Your Custom Rules** below. Click **Reject** on anything that isn't your policy (a reason prompt appears, optional). Every upload and every decision is audit-logged.
8. **See a manual-check rule work.** Approve the *pets* manual-check card, then upload `sample_data/leases/sample_lease_MC-B-0902_pets.pdf` as a new lease (Leases → Add Lease). After processing, open its **AI Review** tab: the pets rule shows **UNDETERMINED** and — the key part — **quotes the lease's own pets clause as evidence**: *"This lease contains possibly relevant text: 'PETS Pets are not permitted in the leased premises without the Landlord's prior written approval…'"*. Read it, click **Override**, write "Verified — pets clause present and compliant", confirm. The requirement was enforced: the system made sure the question got asked, a human answered it, and the answer is on record.
9. **Bulk import via JSON.** The **Upload ruleset JSON** button accepts a file in the same shape as `owner_ruleset.json`: known rules get their thresholds/severity applied in bulk; unknown rules come back listed as skipped with a reason — reported, never executed.

### 3 · Ask AI anything about a lease [AI step]

1. Open any processed lease and click the **Ask AI** tab. There's a question box and a history of previous answers.
2. Type a question in plain language and send. Good ones to try:
   - *"Are pets allowed?"* → answered from the document, quoting the clause.
   - *"Which rules did not pass and why?"* → answered from the rule scorecard, listing each non-passing rule with its reason.
   - *"Who is the tenant and when does the lease end?"* → answered from the verified record.
   - *"Has anyone overridden a rule on this lease?"* → answered from the override history, including who and why.
3. The model receives the **full verified record** — fields with review status, rule results with overrides, flags, the clause index, and the original document text — so it answers from your data, not its imagination. If the lease genuinely doesn't address something, it answers "Not specified in the lease."

### 4 · From tenant complaint to approved work order — the Part B flow

1. First, create the complaint: in a second browser window, log in as the tenant and report an issue with photos (steps in the Tenant walkthrough below). **[AI step]** The vision model analyzes each photo and a draft work order is generated automatically.
2. Back as owner, click **Work Orders** in the sidebar. The new draft is in the list: a short title, what's wrong, the affected unit, priority.
3. Open it. You see the tenant's photos of the problem and the AI's findings per photo — equipment identified, condition rating (good/fair/poor/critical), damage description, confidence.
4. Click **Approve** (it becomes assignable to a technician) or **Reject** with a reason that stays on record. For many drafts at once, use the bulk approve/reject actions on the list.
5. Assign a technician to the approved work order (assign action on the work order), then follow the Technician walkthrough for the repair itself.
6. After the technician completes and runs verification, reopen the work order: **Before** (the tenant's damage photos) and **After** (the completion photos, analyzed by the same vision AI) sit side by side — evidence, not just a "done" checkbox, before you consider the matter closed.

### 5 · One unit, the whole story

1. Click **Units** in the sidebar, then click any unit row — say MC-B-1204.
2. An overview drawer slides out with everything attached to that apartment in one place: the unit's details, its **active lease**, any **pending leases**, **recent inspections** with finding counts, and its **work orders**. One click, one screen — the whole story of the apartment.

### 6 · People: staff and tenants

1. Click **Staff** → **create staff**. Fill email, password, name, phone, and pick the role: *property manager* or *maintenance staff*. The new person can log in immediately; deactivate anyone with one click later.
2. Click **Tenants**. Two ways to add a tenant:
   - **Create directly** — fill their details and pick the unit; the account works immediately.
   - **Send an invitation** — enter their email, name, unit, and move-in date. The system emails them a link. *Demo note:* emails print to the **backend terminal window** — find the invite link there and open it. The invitee sets their own password on the accept page and lands in the tenant portal already bound to their unit.
3. Moving a tenant out is **end assignment** on the Tenants page — occupancy updates, history stays.

### 7 · Money, reports, and the paper trail

1. **Payments** — every approved lease generates a schedule; this page shows all installments across the portfolio, filterable by lease and status. A single lease's schedule is also on that lease's **Payments** tab.
2. **Reports** — portfolio-level charts: occupancy, income, maintenance activity.
3. **Audit** — the append-only record of every decision. Filter by entity type (lease, work order, rule…) or action. Open it after any walkthrough above and you'll find each click you made: who, what, when, previous value, new value. If a question ever starts with "who decided…", this page answers it.

---

## MANAGER

Log in with `manager@truelinks.com` / `Manager@12345`. The interesting part of this walkthrough is what's deliberately *missing*:

1. The dashboard and sidebar look familiar: Leases, Units, Inspections, Work Orders, Payments, Reports, Audit — all present and fully usable.
2. Process a lease exactly like the owner does (walkthrough 1 above): upload, review fields, resolve flags, override rules, approve or reject. Day-to-day lease operations are fully delegated to managers.
3. Now click **Lease Rules**: you can *see* everything — the rules, the custom rules, pending rule proposals — but you cannot change a threshold, create a rule, or approve a proposal. The acceptance policy belongs to the owner alone. (Try it via the API: `PATCH /api/v1/lease-rules/R1/` with a manager token returns **403**.)
4. Look for a **Staff** page — there isn't one. Managers don't create or remove accounts.
5. Everything a manager does is audit-logged under their own name, so the owner can always tell their decisions apart from the manager's.

---

## TECHNICIAN

1. Log in with `tech@truelinks.com` / `Tech@12345`. You land on the **maintenance dashboard**, which lists work orders — filter by status or by "assigned to me".
2. Open an approved work order. The technician sees everything needed to do the job: title, description, priority, the unit, the tenant's photos of the problem, and the AI findings.
3. Click **Start** → status changes `approved → in_progress`. From this moment the tenant's Notifications page shows *"Maintenance Update — work order is now in progress."* The action is audit-logged with who clicked and when.
4. Do the repair (in real life 🙂).
5. Click **Complete** → status changes `in_progress → completed`. Again: the tenant gets a *"has been completed"* notification, and the audit log records it. The state machine blocks shortcuts — completing anything that isn't in progress is rejected, so you can't jump from `approved` straight to `completed`.
6. Optional but the best part — **Start Verification**: right after completing, click Start Verification on the work order → upload after-repair photos in the inspection it creates → click **Analyze** **[AI step]**. The same vision model that read the damage photos reads the repair photos, and the owner sees **Before vs After on the same work order** before considering the matter closed.
7. What the technician *cannot* do is as deliberate as what they can: no lease screens, no rules, and no approving their own work orders — approval and verification judgments stay with the owner/manager.

---

## TENANT

1. Log in with `tenant@truelinks.com` / `Tenant@12345`. The tenant portal opens on **your home**: your unit, your lease summary, and current activity. The portal navigation has Home, Maintenance, Documents, and Notifications — nothing else, because nothing else is the tenant's business.
2. **Report a problem.** Go to **Maintenance** and create a new request: describe the issue in your own words ("AC leaking in the bedroom") and attach one or more photos of it — for a demo, use the images in `sample_data/photos/` (a leaking pipe and a water-damaged ceiling). Submit. That's the whole job — no category trees, no severity guessing. **[AI step]** Behind the scenes the vision model reads your photos, identifies the equipment, rates the condition, and drafts a work order for the owner.
3. **Watch it move.** Open **Notifications**: as the owner approves and the technician starts and completes the job, entries appear — *approved*, *in progress*, *completed*. The silence that makes tenants angry is replaced by status.
4. **Your documents.** The **Documents** page holds your lease and related paperwork. Links are signed and expire after an hour — nothing is publicly reachable.
5. What a tenant *cannot* see is the point of the role model: other tenants' data, other units, owner finances, rules — unreachable by UI and by API alike. A tenant token calling an owner endpoint gets **403**, and the test suite asserts it.

---

## Two cross-cutting things to notice while walking through

- **Every AI output is a proposal.** Extracted fields, flags, rule results, drafted work orders, rule proposals from policy documents — a human approves, rejects, or overrides each one, and UNDETERMINED exists precisely for "the system can't prove it." The AI proposes; a person decides.
- **Every decision has a name on it.** Walk any flow above, then open the Audit page: each approve, reject, override, and status change is there with actor, timestamp, previous value, and new value. That's "traceable and overridable," demonstrated end to end.
