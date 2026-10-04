import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { CATCH_RECORD_SERVER_OWNED_FIELDS } from './canonical-catch-record-server-owned-fields.js'

// Shared CatchNormalization cross-cutting guards (Step 06).
//
// Both guards inspect only the candidate's own-enumerable keys (`Object.keys`), so inherited/prototype
// properties (for example properties added via `Object.create` or the prototype chain) can never bypass
// an allow-list or server-owned-field check. Neither guard mutates the supplied candidate.
function ownKeys(candidate) {
  if (candidate === null || typeof candidate !== 'object') {
    return []
  }

  return Object.keys(candidate)
}

export function assertAllowedKeys(candidate, allowedKeys, { code } = {}) {
  const disallowed = ownKeys(candidate).filter(
    (key) => !allowedKeys.includes(key)
  )

  if (disallowed.length > 0) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'The request contains one or more properties that are not supported.',
      {
        code: code ?? 'UNKNOWN_PROPERTY',
        details: disallowed.map((key) => ({
          path: key,
          code: 'UNKNOWN_PROPERTY'
        }))
      }
    )
  }
}

export function assertNoServerOwnedFields(candidate) {
  const serverOwnedKeysPresent = ownKeys(candidate).filter((key) =>
    CATCH_RECORD_SERVER_OWNED_FIELDS.includes(key)
  )

  if (serverOwnedKeysPresent.length > 0) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'The request attempts to set one or more server-owned fields.',
      {
        code: 'SERVER_OWNED_FIELD_NOT_ALLOWED',
        details: serverOwnedKeysPresent.map((key) => ({
          path: key,
          code: 'SERVER_OWNED_FIELD_NOT_ALLOWED'
        }))
      }
    )
  }
}
