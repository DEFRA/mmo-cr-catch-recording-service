import { decideOwnership } from './ownership-policy.js'

/**
 * Six approved operations - read, draft-update, draft-abandonment, submission, amendment (covering both
 * edit-start and amendment-save), and artifact-access - share exactly the same authorisation shape today:
 * an authenticated caller whose trusted `userId` exactly matches the resource's `ownerUserId`. Lifecycle
 * eligibility (Step 08), expected-version enforcement (Step 11), complete-record/business validation, and
 * persistence are all explicitly out of scope here and are composed separately by later business steps.
 *
 * Implemented once internally and exposed through six distinctly-named functions so each approved
 * operation keeps its own test surface and its own future extension point, without duplicating the same
 * check six times.
 *
 * @param {{ authenticationContext: { userId?: unknown } | null | undefined, ownerUserId: unknown }} input
 * @returns {Readonly<{ decision: string }>}
 */
function decideOwnerScopedOperation({ authenticationContext, ownerUserId }) {
  return decideOwnership({ authenticationContext, ownerUserId })
}

export function decideReadAccess(input) {
  return decideOwnerScopedOperation(input)
}

export function decideDraftUpdateAccess(input) {
  return decideOwnerScopedOperation(input)
}

export function decideDraftAbandonmentAccess(input) {
  return decideOwnerScopedOperation(input)
}

export function decideSubmissionAccess(input) {
  return decideOwnerScopedOperation(input)
}

export function decideAmendmentAccess(input) {
  return decideOwnerScopedOperation(input)
}

export function decideArtifactAccess(input) {
  return decideOwnerScopedOperation(input)
}
