import {
  createValidResult,
  createInvalidResult,
  formatPath
} from '#/catch-recording/validation/validation-result.js'
import { VALIDATION_CODES } from '#/catch-recording/validation/validation-codes.js'

/**
 * Species catch-detail attributes are not a Reference Data Service concept (confirmed in
 * `docs/configuration-decisions.md` and `design/architecture/species-property-completion.md`) - this is
 * Catch Recording's own small, fixed, locally-owned catalogue. `LSC` was already defined in
 * `canonical-catch-record-object.md`; `BMS`/`DIS` are approved placeholder codes. No Reference Data
 * Service call is made for this resolution.
 */
const CATCH_DETAIL_ATTRIBUTES = Object.freeze({
  LSC: Object.freeze({
    nameSnapshot: 'Weight Above Minimum Size Kept Onboard',
    unitSnapshot: 'kg'
  }),
  BMS: Object.freeze({
    nameSnapshot: 'Weight Below Minimum Size Kept Onboard',
    unitSnapshot: 'kg'
  }),
  DIS: Object.freeze({
    nameSnapshot: 'Weight Discarded',
    unitSnapshot: 'kg'
  })
})

/**
 * @param {{ attributeId: unknown, path: Array<string|number> }} input
 * @returns {{ result: { valid: boolean, issues: ReadonlyArray<object> }, snapshot: object|null }}
 */
export function resolveCatchDetailAttribute({ attributeId, path }) {
  const idPath = formatPath([...path, 'attributeId'])

  if (attributeId === undefined || attributeId === null) {
    return {
      result: createInvalidResult({
        code: VALIDATION_CODES.REQUIRED,
        path: idPath,
        message: 'A catch-detail attribute id is required.'
      }),
      snapshot: null
    }
  }

  if (typeof attributeId !== 'string' || attributeId.length === 0) {
    return {
      result: createInvalidResult({
        code: VALIDATION_CODES.INVALID_STRUCTURE,
        path: idPath,
        message: 'The catch-detail attribute id must be a non-empty string.'
      }),
      snapshot: null
    }
  }

  const definition = Object.hasOwn(CATCH_DETAIL_ATTRIBUTES, attributeId)
    ? CATCH_DETAIL_ATTRIBUTES[attributeId]
    : undefined
  if (!definition) {
    return {
      result: createInvalidResult({
        code: VALIDATION_CODES.INVALID_REFERENCE,
        path: idPath,
        message: 'The catch-detail attribute id is not recognised.'
      }),
      snapshot: null
    }
  }

  return {
    result: createValidResult(),
    snapshot: Object.freeze({ ...definition })
  }
}
