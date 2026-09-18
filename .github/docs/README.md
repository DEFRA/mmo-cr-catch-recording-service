# Standardised Copilot agent workflow — backend service

## Overview

AI adoption has become an increasingly important part of modern software delivery, especially for coding
and engineering workflows using GitHub Copilot. To improve the experience of developers, QA engineers and
DevOps engineers, a standardised agent setup is applied across repositories to provide accurate context,
clear responsibilities and consistent guidance.

This document describes the standardised Copilot agent workflow as applied to this **backend service**
repository (Node.js, Hapi.js, Joi, MongoDB on the DEFRA Core Delivery Platform). It covers the `.github`
directory structure, the working framework, each agent's role and boundaries, each skill's purpose, and how
the components fit together in practice.

Each repository uses the same four-agent orchestrated workflow, driven by a single working framework
defined in `copilot-instructions.md`. The design separates responsibilities cleanly:

- **Orchestrator** — coordinates the workflow and never modifies code.
- **Planner** — plans and researches but never modifies code (used for **Complex** work only).
- **Developer** — implements changes, and writes and runs code after a plan is approved.
- **Reviewer** — performs read-only reviews and reports findings by severity (**optional, on-request**).

Alongside these four agents, a small set of skills provides specialist guidance that agents load at the
appropriate point in the workflow.

> **Canonical source.** The §3 working framework in `copilot-instructions.md` is shared verbatim across the
> Catch Recording repositories, with `DEFRA/mmo-cr-external-frontend` as the canonical copy. Only two
> repo-specific substitutions are made here: the planning agent link, and the design-authority sentence in
> step 6, which becomes an **API contract** authority for a backend service. Any other change to §3 must be
> made in the canonical copy first and propagated.

## What is different in a backend service

This repository serves a **JSON API**, not web pages. Compared with the frontend workflow:

| Frontend concern                             | Backend equivalent here                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| GOV.UK Design System / Figma design fidelity | **API contract fidelity** — response shapes, status codes and error shapes |
| WCAG 2.2 AA accessibility                    | **Boundary validation, authN/authZ and injection safety**                  |
| Nunjucks views, progressive enhancement      | **Joi schemas, thin handlers, services, MongoDB data access**              |
| Visual verification in a browser             | **API verification** against the running service with `curl`               |
| GDS deviation register                       | **Breaking-change register** for published routes                          |

Accordingly the frontend-only artefacts (accessibility and Figma instructions, the `figma-to-web-ui`,
`web-accessibility-audit` and `fetch-figma-design` skills) are **not** present here.

## `.github` directory structure

```text
.github/
├── copilot-instructions.md          # Primary context file, loaded automatically for every chat
├── commit-message-generation.instructions.md
├── agents/
│   ├── catch-recording-orchestrator.agent.md
│   ├── catch-recording-planner.agent.md
│   ├── catch-recording-developer.agent.md
│   └── catch-recording-code-reviewer.agent.md
├── instructions/
│   ├── nodejs-hapi-api.instructions.md     # applyTo: src/**/*.js
│   ├── security.instructions.md            # applyTo: src/**/*.js
│   ├── data-persistence.instructions.md    # applyTo: src/**/*.js
│   └── testing.instructions.md             # applyTo: **/*.test.js
├── prompts/
│   ├── jira-ticket-to-code.prompt.md
│   └── api-endpoint-from-spec.prompt.md
└── skills/
    ├── deep-research-defra-alignment/
    ├── api-endpoint-design/
    ├── unit-tests/
    ├── fetch-jira-workitem/
    └── fetch-confluence-page/
```

Agent names are **service-scoped** (`Catch Recording Orchestrator`, `Catch Recording Planner`, `Catch Recording Developer`,
`Catch Recording Code Reviewer`) so they stay unique when several Catch Recording repositories are open in the same
multi-root workspace.

> **Note on prompt files.** VS Code has deprecated `*.prompt.md` for Agent Host sessions and recommends
> migrating prompts to skills. The two prompts here still work with the local agent; when the team moves to
> Agent Host, convert them into skills under `.github/skills/` with the same content.

## `copilot-instructions.md`

The primary context file is loaded automatically whenever a chat or agent session starts in the workspace
folder. It contains the following sections.

| Section                                                  | Purpose                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project overview                                         | Repository-specific context: what the service does and which agents inherit these rules.                                                                                 |
| §1 Standards precedence                                  | Resolves conflicts using the defined standards hierarchy. Any DEFRA deviation requires a governance exception.                                                           |
| §2 Mandatory DEFRA constraints                           | Encryption in transit, boundary validation, API contract stability, PII-safe logging and SOC auditing, health/readiness, no secrets, `.copilotignore`, Secure by Design. |
| §3 Working framework                                     | The single source of truth for the working loop. **Do not alter.**                                                                                                       |
| §4 Tech stack · §5 Commands · §6 Conventions · §7 Layout | Repository-specific facts agents use before acting.                                                                                                                      |

## Working framework

The framework is the single source of truth for how work is carried out. Agents must reference it rather
than restating or creating alternative versions of the workflow. The guiding principle is **match effort to
risk**: do the least work that still delivers the change safely and to standard.

### Triage first — three gears

| Gear         | What it is                                                                                                                                                                     | How to proceed                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trivial**  | A typo, comment/doc tweak, or a small localised change with no impact on architecture, routing, persistence, auth or security.                                                 | Fast path: **Read → Implement → Test → Summarise**. Skip the Planner, research and review. No approval gate.                                                                                                                                |
| **Standard** | A normal route, service or fix with **no** new architecture, auth, persistence strategy or security surface, and **no** breaking contract change.                              | **Lightweight inline plan** (Objective · Plan · Files · Validation · Risks) — no heavyweight Planner. Get approval, implement and test. A single research pass runs only if something is genuinely uncertain. Review is not run by default. |
| **Complex**  | New architecture, persistence/caching strategy, external integration, auth, a security surface, **a breaking API contract change**, or multi-item delivery (e.g. a JIRA epic). | Full loop with the **Planner** and its full plan → approval → implement → test. Review still opt-in.                                                                                                                                        |

#### Examples — what triggers each gear

**Trivial**

- Fixing a typo in a comment, `README` or ADR.
- Bumping one constant or config default with no behavioural impact.
- Adding a missing test for behaviour that already exists and is understood.
- Tightening a log message that carries no PII.

**Standard**

- Adding a new read endpoint on an existing collection, following the established route pattern.
- Adding a field to an existing Joi schema, with validation and tests.
- Adding a projection, a bound or a sort to an existing query.
- A localised bug fix in a service or helper where cause and fix are understood.
- Adding a new service function and wiring it into an existing handler.

**Complex**

- Introducing or changing authentication or authorisation.
- A new external service integration, or changing how outbound calls are made.
- A persistence or caching strategy change, a new collection, or an index/data migration.
- **Any breaking change to a published request or response shape, status code or error shape.**
- Anything touching a security surface, secrets handling, or PII.
- Delivering a JIRA epic and its child stories/spikes/bugs in sequence.

### Manual triage override — force a gear

Automatic triage is only the default. **You can force a gear** — an explicit instruction wins over the
automatic classification.

| To force…                | Say something like…                                                      |
| ------------------------ | ------------------------------------------------------------------------ |
| **Trivial** fast path    | "Treat this as trivial", "just make the change, no plan needed".         |
| **Standard** inline plan | "Do a lightweight/standard plan", "skip the planner, just a short plan". |
| **Complex** full plan    | "Force the full plan", "use the planner", "run a full plan and review".  |
| **A review**             | "Review this", or answer **Yes** to the end-of-work review offer.        |

Rules the agents follow:

- **Escalation is always honoured** — you can ask for _more_ rigour on anything.
- **De-escalation is honoured with a caveat** — if you ask for a _lighter_ path than the risk warrants, the
  agent complies but first flags the risk in one line. It will **not** drop the approval gate or security
  for a change that genuinely touches architecture, auth, persistence, data correctness or a security
  surface.
- The agent echoes back which gear it is running so you can correct it.

### The loop (Standard and Complex)

```text
1. Read       - Read the relevant files/config. Never assume; verify.
2. Research   - A SINGLE risk-scoped pass, only when something is genuinely
                uncertain, via the deep-research-defra-alignment skill.
                Cite sources. There is NO separate validation-research round.
3. Clarify    - Ask targeted questions when requirements are ambiguous.
4. Plan       - Complex : delegate to the Planner (full plan, sources cited).
                Standard: produce a lightweight inline plan directly.
                Check the risky steps are covered/cited; revise only on a gap.
5. Approval   - Present the plan and ask a single Yes/No question. Stop and
                wait. Cap the plan -> approve -> implement cycle at 3 attempts.
6. Implement  - Execute the approved plan one phase at a time; no scope creep.
                Create ADRs first when architecture is established/altered.
                The API CONTRACT is the authority: version breaking changes
                and record every one of them.
7. Test       - Run build, tests and lint; confirm green before proceeding.
                For endpoint changes, VERIFY against the running service.
8. Iterate    - Refine until the user is satisfied.
9. Summarise  - Executive summary: what changed, why, how it was validated,
                any contract/breaking changes recorded, follow-ups and risks.
```

**Code review is optional and on-request.** It is **not** part of the default loop. At the end of
implementation, if no review has been run, the agent offers one with a single Yes/No question and invokes
the Reviewer only on **Yes**.

## Agents

### Catch Recording Orchestrator

| Property       | Value                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| File           | `agents/catch-recording-orchestrator.agent.md`                                                                            |
| Tools          | Read, search, todo, agent. **No** edit or execute access.                                                                 |
| When to invoke | Complex, multi-step work needing planning, coordination and a formal approval gate; or JIRA epic / multi-ticket delivery. |

**Responsibilities**

- Triages the request into Trivial / Standard / Complex (honouring any manual override) and echoes the gear.
- Gathers enough workspace context (using the Explore subagent where useful) to write a clear brief.
- **Standard work:** briefs the Developer to produce a lightweight inline plan — the Planner is not used.
- **Complex work:** delegates planning and the single research pass to the Planner, then checks the plan
  covers the risky steps and cites sources.
- Presents the plan to the user and owns the mandatory Yes/No approval gate.
- Delegates the approved plan to the Developer one phase at a time.
- **Offers an optional review at the end** (single Yes/No); delegates to the Reviewer only on **Yes** and
  sends Blocking findings back to the Developer.
- Closes with an executive summary, including any API contract or breaking changes recorded.

**Hard boundaries**

- Does not implement or edit files, or run build/test/deploy commands.
- Does not begin implementation before explicit user approval.
- Does not run a code review by default.
- Does not perform open research itself — it delegates the single research pass.
- Does not fetch JIRA data, attachments or linked files itself.

### Catch Recording Planner

| Property       | Value                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| File           | `agents/catch-recording-planner.agent.md`                                       |
| Tools          | Read, search, web, agent. **No** edit or execute access.                        |
| When to invoke | Called by the Orchestrator for **Complex** work. Not normally invoked directly. |

**Responsibilities**

- Converts the brief into a clear objective and scope boundary.
- Performs the **single, risk-scoped** research pass via `deep-research-defra-alignment` and cites sources.
- Produces an implementation plan (phase sequence, parallelisation, impacted files, **API contract impact**,
  validation strategy, required tests, risks, sources).
- Scales output: **short-form** for Standard work it is asked to plan, **full** contract for Complex work.
- Returns the plan to the Orchestrator, not directly to the user.

**Output contract — full (Complex work)**

Objective · Scope · Assumptions and Open Questions · Implementation Plan · File/Component Impact ·
**API Contract Impact** · Validation Plan · Risks and Mitigations · Research and Sources · Approval
Checklist.

**Output contract — short-form (Standard work)**

Objective · Implementation Plan · File/Component Impact · Validation Plan · Risks, Assumptions and Sources.

### Catch Recording Developer

| Property       | Value                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| File           | `agents/catch-recording-developer.agent.md`                                                                             |
| Tools          | Full implementation toolset: edit, execute, VS Code, web, search, todo.                                                 |
| When to invoke | To implement a feature, fix or refactor — ideally from an already-approved plan; or directly for Trivial/Standard work. |

**Responsibilities**

- Owns implementation, testing and iteration, and the single research pass when it plans Standard work.
- Triages when invoked directly (Trivial → straight through; Standard → lightweight inline plan + approval;
  Complex → delegate to the Planner + approval).
- Implements an approved plan one phase at a time, without replanning it.
- Runs build/test/lint after each phase; ships tests alongside code, including the negative paths.
- **For endpoint changes: runs the service and verifies each changed route** — happy path, validation
  failure (400 with all errors), not-found/unauthorised, and `/health` — and checks the logs carry no PII.
- Keeps the API contract stable, versions any breaking change and **records every one of them**.

### Catch Recording Code Reviewer

| Property       | Value                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| File           | `agents/catch-recording-code-reviewer.agent.md`                                                       |
| Tools          | Read, search, web, todo, agent. **No** edit or execute access.                                        |
| When to invoke | **Optional and on-request only** — when you ask for a review, or answer Yes to the end-of-work offer. |

**Responsibilities**

- Systematic read-only review against DEFRA standards, API contract stability, security and PII rules,
  validation, data persistence, testing/coverage and repository conventions.
- Reports findings at three severities:
  - **Blocking** — security issues, exposed secrets, missing boundary validation, NoSQL injection risk,
    missing authorisation, an unrecorded breaking contract change, incorrect behaviour, failing/missing
    tests, standards breaches.
  - **Recommended** — improves quality; discuss with the author.
  - **Nit** — minor or optional preference.
- Ends with a count by severity, any contract/breaking change identified, and a ready-to-merge verdict.

## Skills

Skills are loadable knowledge files agents use at the right point in the workflow. They complement
`copilot-instructions.md` rather than duplicating it.

| Skill                           | User-invocable | Purpose                                                                                                                                                                                             |
| ------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deep-research-defra-alignment` | No             | The **single** risk-scoped research pass (§3.2). Returns a sourced, DEFRA-aligned recommendation: Question · Findings (cited) · Recommendation · DEFRA alignment · Risks and alternative · Sources. |
| `api-endpoint-design`           | No             | Build or change an endpoint end-to-end: contract design, route module, Joi schema, thin handler, service, Boom mapping, router registration, indexes, tests and API docs.                           |
| `unit-tests`                    | No             | Write and strengthen Vitest tests: `server.inject` route tests, service tests, `vitest-mongodb` repository tests, negative paths, tiered coverage.                                                  |
| `fetch-jira-workitem`           | Yes            | **Strictly read-only** Jira fetch of a ticket and its hierarchy, returning sanitised, PII-free data. Never writes, never downloads attachments.                                                     |
| `fetch-confluence-page`         | Yes            | **Strictly read-only** Confluence fetch of a single page, returning sanitised, PII-free content. Never writes, never downloads attachments.                                                         |

Both `fetch-*` skills read credentials from a local, git-ignored `.env` created from the bundled
`assets/.env.example`. **Never read, echo or commit that `.env`** — `.copilotignore` and `.gitignore` both
exclude it.

## Prompts

| Prompt                    | Entry point for                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/jira-ticket-to-code`    | Delivering a JIRA ticket or epic end-to-end. Fetches the ticket read-only, parses each leaf ticket into a delivery brief, and hands them to the Orchestrator to sequence and deliver one at a time. |
| `/api-endpoint-from-spec` | Building or changing an endpoint from an API contract, OpenAPI snippet or acceptance criteria. Captures the contract explicitly first, then runs the §3 loop.                                       |

## How the pieces fit together

```text
User in chat or agent mode
       │
       ▼
Catch Recording Orchestrator                    Coordinates; does not modify code
  │
  ├─ Triage → Trivial / Standard / Complex   (manual override wins)
  │
  ├─ Standard: Developer writes a lightweight inline plan
  ├─ Complex : Delegates planning ──► Catch Recording Planner
  │                                     └─ single research pass via
  │                                        deep-research-defra-alignment
  │
  ├─ Presents plan and waits for Yes/No   ◄── APPROVAL GATE (hard stop)
  │
  ├─ Delegates implementation ──────► Catch Recording Developer
  │                                     ├─ keeps the API contract stable
  │                                     ├─ ships tests with the code
  │                                     └─ verifies routes on the running service
  │
  └─ Offers optional review ────────► Catch Recording Code Reviewer   (only on Yes)
       │                              Read-only findings by severity
       │
       └─ Executive summary to user
```

For Trivial work the Orchestrator (or the Developer directly) uses the fast path with no Planner and no
approval gate. The Developer can be invoked directly with an already-approved plan. The Reviewer can be
invoked independently at any time.

## Standards precedence

1. DEFRA Software Development Standards.
2. DEFRA Digital Service Manual.
3. GOV.UK Service Standard and Service Manual (GDS).
4. DEFRA technology standards (Node.js, JavaScript, logging, security).
5. Community best practice (OWASP Top 10 and API Security Top 10, Hapi/Joi/MongoDB/Node conventions).

Any deviation from a DEFRA standard must be raised as a formal exception through the appropriate
architecture governance route (Delivery Architecture, `delivery.architecture@defra.gov.uk`). Agents must
never deviate silently.

> **API contract authority.** When a change touches a published route, the contract is treated as the
> authority: keep it stable, version any breaking change, preserve backward compatibility while consumers
> depend on it, and **record every breaking change**. **Security and data correctness remain hard
> overrides** that still win over convenience.

## Universal quality gates

Before a change is merged, all applicable quality gates must pass:

- `npm run lint` and `npm run format:check` pass.
- All tests pass with no regressions (`npm test`), including the negative paths.
- Coverage meets the tiered targets (≥90% global, ≥95% core logic, 100% error-handling and
  security-critical paths) and does not fall below the SonarCloud baseline.
- The SonarCloud quality gate passes; no new bugs, vulnerabilities or unacceptable code smells; security
  hotspots reviewed and resolved.
- `npm run security-audit` shows no critical advisories.
- Endpoint changes have been **verified against the running service**.
- Any change to a published contract is versioned and **recorded as breaking** where it is.
- At least one approving review is provided by another developer.

## Usage guidance for developers

### Which agent should I use?

The decision comes down to one question: **does this work need a plan approved before anyone writes code?**

#### Use the Orchestrator when

Select `Catch Recording Orchestrator` in VS Code agent mode.

| Scenario                                                  | Why                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| New feature or significant behaviour change               | Needs decomposition, dependency ordering and a reviewable plan.    |
| Change to auth, persistence or an external integration    | Higher blast radius — research and an approval gate are essential. |
| A breaking change to a published request/response shape   | Consumers depend on it; it must be versioned and recorded.         |
| Security-relevant change (auth, secrets, validation, PII) | Needs careful planning, validation and comprehensive testing.      |
| A new collection, index or data migration                 | Needs sequencing and a rollback story.                             |
| A JIRA epic with child tickets                            | The Orchestrator sequences and delivers one ticket at a time.      |

#### Use the Developer directly when

Select `Catch Recording Developer` in VS Code agent mode.

| Scenario                                                      | Gear     |
| ------------------------------------------------------------- | -------- |
| Typo, wording fix or comment update                           | Trivial  |
| Single config default or constant with no behavioural impact  | Trivial  |
| Missing test for behaviour already implemented and understood | Trivial  |
| Failing test with a known root cause                          | Trivial  |
| A new read endpoint following the established route pattern   | Standard |
| Adding a validated field to an existing schema                | Standard |
| A localised bug fix where cause and solution are understood   | Standard |

### Decision guide

```text
Do you want to force a specific flow?
  ├─ Yes ─► State it in your prompt (see "Manual triage override").
  └─ No  ─► Automatic triage applies:

Is the change trivial?
  (typo, doc, single config value, obvious small fix, missing test for known behaviour)
        │
       Yes ──► Catch Recording Developer directly — Read → Implement → Test → Summarise
        │
        No
        │
Does it affect architecture, auth, security, integrations, persistence,
or the published API contract?
        │
       Yes ──► Catch Recording Orchestrator — Plan → Approval → Implement → (optional) Review
        │
        No  ──► Catch Recording Developer directly (Standard: lightweight inline plan → approval → implement).
                The Developer re-triages and delegates to the Planner if it turns out riskier.
```

### Using the Reviewer independently

The Reviewer is **optional and on-request**. It needs no plan or approval gate. Point it at the work, for
example:

- `Review the changes on branch feature/my-change.`
- `Review the files changed in the latest commit.`
