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
// The two approved `weightPrecision` values (Step 27 redesign - service-owner decision). No other
// value is approved; do not infer a third precision level.
const WEIGHT_PRECISION_VALUES = ['wholeNumber', 'oneDecimalPlace']
// Root-level fields that must never appear on a Catch Record: landed species/statistical area always
// belong to a gear association, never the root, and history is a separate append-only mechanism.
// `speciesNotLanded` is the one approved exception (Step 27 redesign, service-owner decision): it is a
// single, trip-level, root collection - not landed, so not tied to any one gear.
const FORBIDDEN_ROOT_FIELDS = Object.freeze({
  statisticalArea:
    'Statistical area must belong to a gear association, not the Catch Record root',
  speciesCaught:
    'Landed species must belong to a gear association, not the Catch Record root',
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

function isNullableFiniteNumber(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * Validates one species-caught-or-not-landed entry's structural shape only (Step 27 redesign):
 * nullable-finite-number weight fields and an approved `weightPrecision`. Shared by both the per-gear
 * `speciesCaught` collection and the root-level `speciesNotLanded` collection, since both use the
 * identical entry shape. Deliberately does **not** require `id` here - exactly like `gear.id` is never
 * required by this structural layer (see `validateGearAssociation`, which checks only the gear's own
 * stable `associationId`), authoritative-reference requiredness is a section-validator business concern
 * (`validateSpeciesCaught`/`validateSpeciesNotLanded`), not a structural one. Species no longer has a
 * separate synthetic relationship `associationId` to check structurally at all.
 *
 * @param {unknown} speciesEntry
 * @param {Array<string|number>} pathSegments
 * @returns {ReadonlyArray<object>}
 */
function validateSpeciesEntry(speciesEntry, pathSegments) {
  const issues = validateElementShape(speciesEntry, pathSegments)
  if (issues.length > 0) {
    return issues
  }

  for (const field of [
    'weightAboveMinimumKg',
    'weightBelowMinimumKg',
    'weightLegallyDiscardedKg'
  ]) {
    if (
      Object.hasOwn(speciesEntry, field) &&
      !isNullableFiniteNumber(speciesEntry[field])
    ) {
      issues.push(
        issue(
          VALIDATION_CODES.INVALID_STRUCTURE,
          [...pathSegments, field],
          INVALID_STRUCTURE_MESSAGE
        )
      )
    }
  }

  if (
    Object.hasOwn(speciesEntry, 'weightPrecision') &&
    speciesEntry.weightPrecision !== null &&
    !WEIGHT_PRECISION_VALUES.includes(speciesEntry.weightPrecision)
  ) {
    issues.push(
      issue(
        VALIDATION_CODES.UNSUPPORTED_VALUE,
        [...pathSegments, 'weightPrecision'],
        'Unsupported weight precision'
      )
    )
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
    gearAssociation.speciesCaught.forEach((speciesEntry, index) => {
      issues.push(
        ...validateSpeciesEntry(speciesEntry, [
          ...pathSegments,
          'speciesCaught',
          index
        ])
      )
    })
  }

  return issues
}

function validateSpeciesNotLandedCollection(catchRecord) {
  const issues = validateContainerShape(
    catchRecord.speciesNotLanded,
    ['speciesNotLanded'],
    { allowArray: true }
  )

  if (Array.isArray(catchRecord.speciesNotLanded)) {
    catchRecord.speciesNotLanded.forEach((speciesEntry, index) => {
      issues.push(
        ...validateSpeciesEntry(speciesEntry, ['speciesNotLanded', index])
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
 * root-level `statisticalArea` or landed `speciesCaught` (both always nested under a gear association),
 * while `speciesNotLanded` is the one approved root-level species collection (Step 27 redesign — it is a
 * single, trip-level list, not tied to any one gear). Does not implement submission-readiness
 * completeness, reference-data validity, or lifecycle eligibility.
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

  for (const field of ['vessel', 'trip', 'pairFishing']) {
    issues.push(
      ...validateContainerShape(catchRecord[field], [field], {
        allowObject: true
      })
    )
  }

  issues.push(
    ...validateForbiddenRootFields(catchRecord),
    ...validateGearsCollection(catchRecord),
    ...validateSpeciesNotLandedCollection(catchRecord),
    ...validateArtifacts(catchRecord.artifacts)
  )

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}

// Exported only for reuse by sibling validators that need the same shape guard without duplicating it.
export { isPlainObject, isNonEmptyString, issue, validateContainerShape }
