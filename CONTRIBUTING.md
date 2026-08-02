# Contributing to TransTrack

Thank you for your interest in contributing to TransTrack! This document provides guidelines for contributing to the project.

TransTrack is a regulated medical-operations product. Contributions to it are
subject to change control: the review requirements in
[Code review and branch protection](#code-review-and-branch-protection) are not
a courtesy, they are the mechanism by which the project can state that no
security or clinical control reached a release without a second pair of eyes.

## Code of Conduct

Please be respectful and professional in all interactions. We are committed to providing a welcoming environment for everyone.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- Git

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/TransTrack.git
   cd TransTrack
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start development:
   ```bash
   npm run dev:electron
   ```

## Development Guidelines

### Code Style

- Use ESLint for JavaScript/TypeScript linting
- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic

### Commit Messages

Use clear, descriptive commit messages:
- `feat: Add patient export to PDF`
- `fix: Correct priority calculation for kidney patients`
- `docs: Update installation instructions`
- `refactor: Simplify donor matching algorithm`

### Pull Requests

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes
3. Run tests and linting:
   ```bash
   npm run lint
   npm test
   ```

4. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

5. Create a Pull Request with:
   - Clear description of changes
   - Screenshots if UI changes
   - Any breaking changes noted

## Code review and branch protection

### Code owners

[`.github/CODEOWNERS`](.github/CODEOWNERS) assigns mandatory reviewers to the
security-critical and clinically-critical paths: the Electron IPC boundary, the
database schema and migrations, authentication and SSO, the audit chain,
encryption and secure delete, the logger and SIEM forwarder, the clinical
calculators and their reference data, the server-tier FHIR/SMART authorization
layer, the controlled documents under `docs/compliance/`, the release and
signing scripts, and the tests that verify all of the above.

The team handles in that file are placeholders. They must be created in the
GitHub organization before code-owner review is enforced — an unresolvable team
handle matches nobody, and the protection rule then passes silently.

### Required branch protection settings

These are the settings the project requires on `main`. They are recorded here
because a protection rule that exists only in a repository setting is invisible
to a validation reviewer and is lost if the repository is forked or migrated.

**Protected branch:** `main`

| Setting | Required value | Why |
|---|---|---|
| Require a pull request before merging | Enabled | No direct pushes to `main`. Every change has a reviewable diff. |
| Required approvals | **2** for paths owned by `@transtrack/platform-security` or `@transtrack/clinical-informatics`; **1** otherwise | A single approval is adequate for routine change; a control change should not rest on one reviewer's attention. |
| Dismiss stale approvals on new commits | Enabled | An approval is of a diff, not of a branch name. |
| Require review from Code Owners | Enabled | Makes `.github/CODEOWNERS` binding rather than advisory. |
| Require approval of the most recent reviewable push | Enabled | Prevents self-approving a change appended after review. |
| Require conversation resolution before merging | Enabled | A review comment cannot be merged past without a response. |
| Require status checks to pass | Enabled, strict (branch must be up to date) | See the required checks below. |
| Require signed commits | Enabled | Establishes authorship for the change record. |
| Require linear history | Enabled | Keeps the audit trail of changes readable. |
| Include administrators | Enabled | An exemption for administrators is an exemption for the control. |
| Allow force pushes | Disabled | History rewriting destroys the change record. |
| Allow deletions | Disabled | — |
| Restrict who can push | Maintainers only, via pull request | — |

**Required status checks** (job names as they appear in the workflows):

| Check | Workflow |
|---|---|
| `build` | `.github/workflows/ci.yml` |
| `Server Tests` | `.github/workflows/ci.yml` |
| `Playwright E2E Tests` | `.github/workflows/ci.yml` |
| `Windows Build Verification` | `.github/workflows/ci.yml` |
| `Dependency Audit` | `.github/workflows/security.yml` |
| `Committed Secret Scan` | `.github/workflows/security.yml` |
| `Lint & Static Analysis` | `.github/workflows/security.yml` |
| `Security Tests` | `.github/workflows/security.yml` |
| `Lockfile Integrity` | `.github/workflows/security.yml` |
| `Analyze (javascript)` | `.github/workflows/codeql.yml` |

Adding a status check to a workflow does not make it required. It must also be
selected in the branch protection rule, or a failing job will not block a
merge.

### Applying the settings

```bash
# Inspect the current rule
gh api repos/:owner/:repo/branches/main/protection

# Apply from a checked-in definition, if the repository keeps one
gh api -X PUT repos/:owner/:repo/branches/main/protection --input branch-protection.json
```

Any deviation from the table above — a temporarily disabled check, an
administrator override, a merge with one approval on a security path — is a
change-control exception and must be recorded under
[`docs/compliance/policies/CHANGE_MANAGEMENT_SOP.md`](docs/compliance/policies/CHANGE_MANAGEMENT_SOP.md)
with a reason, an owner and a date by which the normal control is restored.

### Verification status

These settings are documented here as the required configuration. Whether they
are currently applied to the GitHub repository cannot be evidenced from within
the repository itself; confirm the live rule with the `gh api` command above
before relying on it. Prior to 2026-08-02 there was no CODEOWNERS file and no
documented branch protection at all (validation finding L-16).

## Compliance Considerations

When contributing, please ensure:

1. **No PHI in code or fixtures.** Never include real patient data, in any
   form, including de-identified extracts, log excerpts, screenshots and
   support bundles. Read
   [`docs/TEST_DATA_PROVENANCE.md`](docs/TEST_DATA_PROVENANCE.md) before adding
   any new fixture, and record its provenance there.
2. **Audit logging.** All data modifications must be logged through the single
   fail-closed audit writer. Do not add a second write path.
3. **Access control.** Respect role-based permissions and organization scoping.
   A new IPC handler or REST route without an explicit authorization check is a
   defect regardless of what it returns.
4. **Secure coding.** Parameterized queries, column allow-lists, no PHI in
   error messages.
5. **Clinical constants are controlled.** Do not change a calculator
   coefficient, threshold or percentile table without a corresponding entry in
   [`docs/compliance/CLINICAL_SOURCES.md`](docs/compliance/CLINICAL_SOURCES.md)
   citing the controlled source. If a source cannot be verified, the correct
   behaviour is to fail closed rather than to compute from a secondary source.
6. **Documentation must match the implementation.** A document that overstates
   what the software does is a validation defect in its own right, which is
   what finding M-17 recorded. If your change makes a claim in the README, the
   compliance mapping or the traceability matrix inaccurate, fix the document
   in the same pull request.
7. **Traceability.** If your change implements or alters a numbered
   requirement, update
   [`docs/compliance/TRACEABILITY_MATRIX.md`](docs/compliance/TRACEABILITY_MATRIX.md).
   Cite test files that actually exist — the automated consistency gate does
   not currently verify that, so a wrong citation will merge.

## Testing

- Write tests for new features
- Ensure existing tests pass
- Test on Windows, macOS, and Linux if possible
- Never weaken or skip a security-control test to make a change pass. Those
  suites are the executable form of the Operational Qualification; changing one
  requires review by `@transtrack/platform-security` and, if it changes what a
  qualified control does, a change-control record.

## Documentation

- Update documentation for new features
- Include JSDoc comments for functions
- Update the changelog
- Controlled documents (anything under `docs/compliance/`, plus `SECURITY.md`
  and `RUNBOOK.md`) carry a document-control header with Document ID, Version,
  Status, Effective date and Owner, and a change-history table at the foot.
  Bump the version and add a change-history row when you edit one.

## Questions?

Open an issue for questions or discussions. For anything security-sensitive,
follow [`SECURITY.md`](SECURITY.md#reporting-a-security-issue) instead of
opening a public issue.

---

Thank you for contributing to TransTrack!
