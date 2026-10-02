import {
  CATEGORY_FALLBACK_CODE,
  isApplicationErrorCategory
} from './error-categories.js'
import { buildSafeDetails } from './safe-details.js'

// Shared Catch Recording application-error contract (Step 03).
//
// Framework-agnostic: no Hapi or Boom import. Safe for use by any application or domain boundary,
// including the Step 02 Catch Recording components (src/catch-recording/). Only the HTTP boundary
// (src/common/helpers/errors/http-error-mapper.js and src/plugins/error-mapping.js) converts an
// ApplicationError into an HTTP response.
//
// Deliberately NOT frozen: freezing an Error instance before its lazily-computed `.stack` property is
// first read causes V8 to throw ("Cannot assign to read only property 'stack'") under ES module strict
// mode. Only the derived `details` and `meta` sub-objects are frozen.
export class ApplicationError extends Error {
  constructor(category, message, { code, details, cause, meta } = {}) {
    if (!isApplicationErrorCategory(category)) {
      throw new Error(`Unsupported application error category: "${category}"`)
    }

    if (!message) {
      throw new Error('ApplicationError requires a safe public message')
    }

    super(message, cause !== undefined ? { cause } : undefined)

    this.name = 'ApplicationError'
    this.category = category
    this.code = code ?? CATEGORY_FALLBACK_CODE[category]
    this.details = buildSafeDetails(details)

    // Non-enumerable, like the native `cause`: accessible internally (error.meta) for diagnostics, but
    // never serialised by JSON.stringify, Object.keys, spread, or a naive console.log(JSON form).
    Object.defineProperty(this, 'meta', {
      value: Object.freeze({ ...meta }),
      enumerable: false,
      writable: false,
      configurable: false
    })
  }
}

export function isApplicationError(value) {
  return value instanceof ApplicationError
}
