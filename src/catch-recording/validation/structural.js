import { CANONICAL_SCHEMA_VERSION } from '../domain/canonical-catch-record.js'
import { isPersistedStatus } from '../domain/lifecycle-status.js'
import { VALIDATION_CODES } from './validation-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from './validation-result.js'

const FORBIDDEN_ARTIFACT_BODY_FIELDS = ['content', 'body', 'json', 'pdf']
const INVALID_STRUCTURE_MESSAGE = 'Invalid structure'
// Root-level fields that must never appear on a Catch Record: statistical area and species always
// belong to a gear association, never the root, and history is a separate append-only mechanism.
const FORBIDDEN_ROOT_FIELDS = Object.freeze({
  statisticalArea:
    'Statistical area must belong to a gear association, not the Catch Record root',
  speciesCaught:
    'Species must belong to a gear association, not the Catch Record root',
  history: 'History must not be embedded',
  events: 'History must not be embedded'
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function issue(code, pathSegments, message) {
  return {
    code,
    path: formatPath(pathSegments),
    message
  }
}

function validateContainerShape(
  value,
  pathSegments,
  { allowArray, allowObject }
) {
  if (value === undefined || value === null) {
    return []
  }

  if (allowArray && Array.isArray(value)) {
    return []
  }

  if (allowObject && isPlainObject(value)) {
    return []
  }

  return [
    issue(
      VALIDATION_CODES.INVALID_STRUCTURE,
      pathSegments,
      INVALID_STRUCTURE_MESSAGE
    )
  ]
}

// Unlike validateContainerShape (used for optional fields, where an absent/null value is valid), an
// *element* of an already-present array must always be a plain object - null/undefined entries are
// invalid, not merely absent.
function validateElementShape(value, pathSegments) {
  return isPlainObject(value)
    ? []
    : [
        issue(
          VALIDATION_CODES.INVALID_STRUCTURE,
          pathSegments,
          INVALID_STRUCTURE_MESSAGE
        )
      ]
}

function validateCharacteristic(characteristic, pathSegments) {
  return validateElementShape(characteristic, pathSegments)
}

function validateCatchDetail(catchDetail, pathSegments) {
  return validateElementShape(catchDetail, pathSegments)
}

function validateSpeciesAssociation(speciesAssociation, pathSegments) {
  const issues = validateElementShape(speciesAssociation, pathSegments)
  if (issues.length > 0) {
    return issues
  }

  if (!isNonEmptyString(speciesAssociation.associationId)) {
    issues.push(
      issue(
        VALIDATION_CODES.REQUIRED,
        [...pathSegments, 'associationId'],
        'Required'
      )
    )
  }

  issues.push(
    ...validateContainerShape(
      speciesAssociation.catchDetails,
      [...pathSegments, 'catchDetails'],
      {
        allowArray: true
      }
    )
  )

  if (Array.isArray(speciesAssociation.catchDetails)) {
    speciesAssociation.catchDetails.forEach((catchDetail, index) => {
      issues.push(
        ...validateCatchDetail(catchDetail, [
          ...pathSegments,
          'catchDetails',
          index
        ])
      )
    })
  }

  return issues
}

function validateGearAssociation(gearAssociation, pathSegments) {
  const issues = validateElementShape(gearAssociation, pathSegments)
  if (issues.length > 0) {
    return issues
  }

  if (!isNonEmptyString(gearAssociation.associationId)) {
    issues.push(
      issue(
        VALIDATION_CODES.REQUIRED,
        [...pathSegments, 'associationId'],
        'Required'
      )
    )
  }

  issues.push(
    ...validateContainerShape(
      gearAssociation.characteristics,
      [...pathSegments, 'characteristics'],
      {
        allowArray: true
      }
    )
  )
  if (Array.isArray(gearAssociation.characteristics)) {
    gearAssociation.characteristics.forEach((characteristic, index) => {
      issues.push(
        ...validateCharacteristic(characteristic, [
          ...pathSegments,
          'characteristics',
          index
        ])
      )
    })
  }

  issues.push(
    ...validateContainerShape(
      gearAssociation.statisticalArea,
      [...pathSegments, 'statisticalArea'],
      {
        allowObject: true
      }
    ),
    ...validateContainerShape(
      gearAssociation.speciesCaught,
      [...pathSegments, 'speciesCaught'],
      {
        allowArray: true
      }
    )
  )
  if (Array.isArray(gearAssociation.speciesCaught)) {
    gearAssociation.speciesCaught.forEach((speciesAssociation, index) => {
      issues.push(
        ...validateSpeciesAssociation(speciesAssociation, [
          ...pathSegments,
          'speciesCaught',
          index
        ])
      )
    })
  }

  return issues
}

function validateArtifacts(artifacts) {
  const issues = validateContainerShape(artifacts, ['artifacts'], {
    allowArray: true
  })
  if (issues.length > 0 || !Array.isArray(artifacts)) {
    return issues
  }

  artifacts.forEach((artifact, index) => {
    if (!isPlainObject(artifact)) {
      return
    }

    for (const field of FORBIDDEN_ARTIFACT_BODY_FIELDS) {
      if (Object.hasOwn(artifact, field)) {
        issues.push(
          issue(
            VALIDATION_CODES.INVALID_STRUCTURE,
            ['artifacts', index, field],
            'Artifact metadata must not contain an artifact body'
          )
        )
      }
    }
  })

  return issues
}

function validateRootEnumFields(catchRecord) {
  const issues = []

  if (
    Object.hasOwn(catchRecord, 'schemaVersion') &&
    catchRecord.schemaVersion !== undefined &&
    catchRecord.schemaVersion !== CANONICAL_SCHEMA_VERSION
  ) {
    issues.push(
      issue(
        VALIDATION_CODES.UNSUPPORTED_VALUE,
        ['schemaVersion'],
        'Unsupported schema version'
      )
    )
  }

  if (
    Object.hasOwn(catchRecord, 'status') &&
    catchRecord.status !== undefined &&
    !isPersistedStatus(catchRecord.status)
  ) {
    issues.push(
      issue(
        VALIDATION_CODES.UNSUPPORTED_VALUE,
        ['status'],
        'Unsupported status'
      )
    )
  }

  return issues
}

// Canonical hierarchy: statistical area/species always belong to a gear association (never the root),
// and history/events (a separate append-only mechanism) must never be embedded in the operational
// object.
function validateForbiddenRootFields(catchRecord) {
  const issues = []

  for (const [field, message] of Object.entries(FORBIDDEN_ROOT_FIELDS)) {
    if (Object.hasOwn(catchRecord, field)) {
      issues.push(issue(VALIDATION_CODES.INVALID_STRUCTURE, [field], message))
    }
  }

  return issues
}

function validateGearsCollection(catchRecord) {
  const issues = validateContainerShape(catchRecord.gears, ['gears'], {
    allowArray: true
  })

  if (Array.isArray(catchRecord.gears)) {
    catchRecord.gears.forEach((gearAssociation, index) => {
      issues.push(...validateGearAssociation(gearAssociation, ['gears', index]))
    })
  }

  return issues
}

/**
 * Validates the canonical structural shape of a Catch Record (or a partial canonical input, since
 * completeness is never required here — only shape-if-present). Enforces the canonical hierarchy: no
 * root-level `statisticalArea` or `speciesCaught`, and every nested gear/species/catch-detail entry
 * nested in its correct place. Does not implement submission-readiness completeness, reference-data
 * validity, or lifecycle eligibility.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validateStructure(catchRecord) {
  if (!isPlainObject(catchRecord)) {
    return createInvalidResult(
      issue(VALIDATION_CODES.INVALID_STRUCTURE, [], INVALID_STRUCTURE_MESSAGE)
    )
  }

  const issues = [...validateRootEnumFields(catchRecord)]

  for (const field of ['vessel', 'trip', 'pairFishing', 'landing']) {
    issues.push(
      ...validateContainerShape(catchRecord[field], [field], {
        allowObject: true
      })
    )
  }

  issues.push(
    ...validateForbiddenRootFields(catchRecord),
    ...validateGearsCollection(catchRecord),
    ...validateArtifacts(catchRecord.artifacts)
  )

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}

// Exported only for reuse by sibling validators that need the same shape guard without duplicating it.
export { isPlainObject, isNonEmptyString, issue, validateContainerShape }
