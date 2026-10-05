---
name: fix-sonar-pr
description: Retrieve the current pull request SonarCloud quality-gate failure, fix actionable findings locally, and verify the remediation without committing or pushing.
argument-hint: Optional PR number. Omit it to use the open PR associated with the current branch.
agent: agent
---

# Fix the SonarCloud Quality Gate for the Current Pull Request

## Required runtime configuration

Run this command with:

- GitHub Copilot built-in agent.
- The organisation-approved Claude Sonnet model selected in the model picker.
- Thinking effort: High.
- The `sonarqube` MCP server running and its tools enabled.
- GitHub CLI authenticated for the current repository.

This is a remediation command. You are authorised to modify relevant source files, tests, and directly related documentation in the current working tree.

Do not commit, push, merge, close, approve, or otherwise modify the pull request.

## Objective

For the open GitHub pull request associated with the current branch:

1. Retrieve the latest GitHub pull-request checks.
2. Identify the failed SonarCloud quality-gate check.
3. Retrieve the pull-request-specific SonarQube quality-gate result and findings.
4. Correct every safely actionable issue introduced by the pull request.
5. Add or update meaningful tests where required.
6. Run complete local verification.
7. Report what was fixed and what must still be confirmed by a new SonarCloud analysis after push.

Do not use the `main` branch quality gate as a substitute for the pull-request analysis.

## Safety and scope constraints

Do not:

- Commit or push changes.
- Merge, close, approve, label, or edit the pull request.
- Change the pull-request base branch.
- Change the SonarQube quality gate or quality profile.
- Mark issues as false positive, accepted, reviewed, safe, or won't fix.
- Suppress warnings merely to pass the quality gate.
- Add broad SonarQube or coverage exclusions.
- Reduce test or coverage requirements.
- Delete tests to make checks pass.
- Modify unrelated files.
- Perform unrelated refactoring.
- Implement functionality outside the approved scope of the current branch.
- Introduce a new dependency unless the existing approved implementation explicitly requires it.
- Introduce optional cache functionality or cache technology.
- Expose tokens, credentials, secrets, or environment-variable values.
- Claim that the official quality gate passes before a new server-side analysis confirms it.

Preserve all existing uncommitted work. Never reset, clean, discard, overwrite, or stash user changes without explicit approval.

## Stage 1: establish repository and pull-request identity

Run:

```bash
git branch --show-current
git status --short
git remote -v
git rev-parse HEAD
gh auth status
```

Determine the pull request associated with the current branch:

```bash
gh pr view --json number,url,title,state,headRefName,baseRefName,headRefOid,baseRefOid,statusCheckRollup
```

If that command cannot resolve a pull request, run:

```bash
gh pr list --state open --head "$(git branch --show-current)" --json number,url,title,headRefName,baseRefName,headRefOid
```

If an optional pull-request number was supplied with this command, verify that it belongs to the checked-out branch before using it.

Record:

- Repository owner and name.
- Pull-request number and URL.
- PR state.
- Head and base branches.
- Local HEAD SHA.
- PR head SHA.
- Existing uncommitted changes.

Stop without changing files if:

- No open pull request can be identified.
- More than one candidate pull request exists and the correct one cannot be determined.
- The checked-out branch does not match the pull-request head branch.
- The local repository is behind or otherwise inconsistent with the PR head in a way that makes remediation unsafe.

Do not switch branches automatically when uncommitted changes exist.

## Stage 2: identify the failed SonarCloud check

Inspect all pull-request checks. Do not stop after seeing successful checks because one check in the rollup may still have failed.

Run:

```bash
gh pr checks <PR_NUMBER>
```

Also filter failed checks from the JSON result:

```bash
gh pr view <PR_NUMBER> --json statusCheckRollup --jq '.statusCheckRollup[] | select(.conclusion == "FAILURE") | {name,status,conclusion,detailsUrl}'
```

Identify the check named `SonarCloud Code Analysis`, or the equivalent SonarQube/SonarCloud quality-gate check.

Confirm that its details URL refers to:

- The current SonarQube project.
- The current numeric pull-request identifier.

Record the original check conclusion and details URL.

If no failed SonarCloud check exists, retrieve the latest SonarQube PR analysis anyway and report whether the check is pending, stale, missing, or already passing. Do not modify files without an actionable finding.

## Stage 3: verify the available SonarQube MCP operations

Inspect the enabled SonarQube MCP tools and use their actual supported argument names.

Identify available operations for:

- Searching SonarQube projects.
- Listing or retrieving pull-request analyses.
- Retrieving pull-request quality-gate status.
- Searching issues using a pull-request identifier.
- Retrieving issue details.
- Retrieving rule details.
- Retrieving security hotspots.
- Retrieving project measures.
- Analyzing local files.

Do not invent tool names or unsupported parameters.

Use the numeric GitHub pull-request number as the SonarQube pull-request identifier unless retrieved evidence proves a different identifier is required.

## Stage 4: retrieve the PR-specific quality gate and findings

Use the SonarQube MCP tools with:

- The SonarQube project key discovered for this repository.
- The numeric pull-request identifier.
- The configured SonarQube organisation.

Retrieve, where supported:

1. Latest PR quality-gate status.
2. Failed quality-gate conditions.
3. Every unresolved new-code issue for the PR.
4. Vulnerabilities.
5. Bugs.
6. Code smells contributing to failed conditions.
7. Blocker, critical, and major issues.
8. Security hotspots introduced by the PR.
9. Coverage on new code.
10. Duplicated lines on new code.
11. Analysis timestamp and analyzed revision or SHA.

For each issue retrieve:

- Issue key.
- Rule key.
- Type.
- Severity.
- Status.
- File path.
- Line or range.
- Message.
- Creation date.
- Relevant rule description or remediation guidance.

Do not query only the default branch. Do not present default-branch findings as if they belonged to the pull request.

## Stage 5: handle missing or inconsistent results

If GitHub reports a failed SonarCloud check but the MCP query returns no PR issues:

1. Verify that the query used the numeric pull-request identifier.
2. Verify the project key and organisation.
3. Determine whether the gate failed because of a metric rather than an individual issue.
4. Inspect coverage, duplication, reliability, security, maintainability, and hotspot conditions.
5. Compare the PR head SHA with the latest analyzed SHA when available.
6. Determine whether the analysis is stale, pending, or inaccessible to the configured token.
7. Use the GitHub check details URL as evidence of the PR analysis.

Do not conclude that no remediation is needed merely because one issue-search operation returns an empty result.

If the installed MCP tools cannot retrieve PR findings but the SonarCloud check provides a directly accessible PR analysis URL, inspect the available check details and report the MCP capability limitation precisely. Continue with local analysis only when the failing files or metrics can be identified reliably.

## Stage 6: build the remediation set

Create a concise internal remediation list for findings attributable to the current pull request.

For each finding record:

- Issue key.
- Rule key.
- Type and severity.
- File and line.
- SonarQube message.
- Failed gate condition affected.
- Cause.
- Smallest safe correction.
- Tests required.
- Whether the correction is safely actionable.

Classify findings as:

- PR-introduced and actionable.
- PR-introduced but requiring a human decision.
- Security hotspot requiring review.
- Metric-only failure.
- Pre-existing and unrelated.
- Uncertain because the server-side analysis is stale or incomplete.

Prioritise:

1. Vulnerabilities.
2. Bugs.
3. Security hotspots.
4. Blocker issues.
5. Critical issues.
6. Major issues.
7. Coverage failure.
8. Duplication failure.
9. Other failed quality-gate conditions.

Before editing, state briefly which files will change and why.

## Stage 7: implement the fixes

For every safely actionable PR-introduced finding:

1. Read the complete affected file.
2. Read directly relevant tests and dependencies.
3. Retrieve the SonarQube rule details.
4. Understand why the rule was triggered.
5. Correct the underlying cause rather than hiding the finding.
6. Preserve approved behaviour, architecture, contracts, exports, and module boundaries.
7. Add or update meaningful focused tests when behaviour is affected.
8. Keep the change limited to the reported problem.
9. Run the relevant focused tests.
10. Re-analyze the complete corrected supported source file with the SonarQube MCP tools.

### Coverage failures

- Identify uncovered new or changed executable lines.
- Add meaningful tests for approved behaviour.
- Exercise success, failure, boundary, and defensive paths where relevant.
- Do not add superficial assertions solely to raise coverage.
- Do not weaken or bypass coverage configuration.

### Duplication failures

- Identify the exact duplicated changed blocks.
- Apply the smallest clear repository-aligned refactoring.
- Preserve readability and module boundaries.
- Do not introduce speculative abstractions.

### Security vulnerabilities and hotspots

- Retrieve the full rule and finding context.
- Correct unsafe behaviour when an approved safe correction is clear.
- Add appropriate tests where feasible.
- Never mark a hotspot reviewed or safe through SonarQube without human approval.
- If remediation depends on a security, privacy, authentication, authorisation, or data-integrity decision, stop only that remediation path and ask a focused question.

## Stage 8: run complete local verification

Read `package.json` and relevant repository configuration. Use actual project scripts rather than assumed command names.

Run:

- Formatting checks.
- Linting.
- Focused tests for corrected areas.
- Complete test suite.
- Coverage command.
- Build or type-check command only if the repository defines one.
- SonarQube MCP local analysis for every corrected supported source file.

Record exact commands and exact results.

Do not claim a check passed when it failed, was skipped, was blocked, or was not run.

Fix only failures introduced by or directly related to the pull request. Do not broaden scope to repair unrelated pre-existing problems.

## Stage 9: assess analysis currency

After local remediation, compare:

```bash
git rev-parse HEAD
gh pr view <PR_NUMBER> --json headRefOid
```

Also record the latest SonarQube analyzed revision or timestamp when available.

If local files changed, state explicitly:

- The current server-side SonarCloud result is stale relative to the local working tree.
- Local MCP analysis is preliminary and does not replace the official PR analysis.
- Official confirmation requires review, commit, push, CI completion, and a new SonarCloud quality-gate calculation.

Do not commit or push.

## Completion criteria

The local remediation is complete only when:

- Every retrievable SonarQube PR finding has been reviewed.
- Every safely actionable PR-introduced finding has been corrected.
- Corrected files pass available local SonarQube MCP analysis.
- Focused tests pass.
- Complete tests pass.
- Linting passes.
- Formatting passes.
- Coverage generation succeeds.
- No known PR-introduced blocker, critical, major, bug, or vulnerability remains.
- Security hotspots are corrected or explicitly reported as requiring human review.
- No suppression, exclusion, or gate weakening was introduced.
- No unrelated change was introduced.

## Final response

Report:

- Pull-request number and URL.
- Head and base branches.
- PR head SHA and local HEAD SHA.
- SonarQube project key and organisation.
- Original SonarCloud check status and details URL.
- Latest analyzed revision or timestamp when available.
- Failed quality-gate conditions.
- All SonarQube findings retrieved.
- Issue key, rule key, type, severity, file, and line for each finding.
- Files modified.
- Correction applied for each finding.
- Tests added or updated.
- Exact verification commands and results.
- Coverage result.
- Local MCP re-analysis results.
- Remaining issues, hotspots, or human decisions.
- Whether the existing server-side result is stale.
- Required next action for official verification.

Use exactly one final status:

- `REMEDIATION COMPLETE LOCALLY, PUSH REQUIRED FOR OFFICIAL VERIFICATION`
- `REMEDIATION PARTIAL, HUMAN DECISION REQUIRED`
- `REMEDIATION BLOCKED`
- `NO ACTIONABLE SONARQUBE PR FINDINGS RETRIEVED`
- `QUALITY GATE ALREADY PASSES`

Do not claim that the official pull-request quality gate passes unless the latest SonarCloud analysis for the current PR head SHA reports success.

Do not commit or push.

If you reach any ambiguity, ask me to clarify.
