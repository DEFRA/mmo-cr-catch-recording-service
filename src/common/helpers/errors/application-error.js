import {
  getCategoryDefinition,
  isSupportedCategory
} from './error-categories.js'
import { sanitiseDetails } from './sanitise-details.js'

/**
 * Framework-neutral application error.
 *
 * Carries a supported category, a stable application code (defaulting to the category's fallback
 * code), a public-safe message, optional safe structured details, and an optional internal `cause`/
 * `meta` that are never publicly serialised. Must not import Hapi or Boom — HTTP translation happens
 * only at the central mapping boundary (`http-error-mapper.js`) and its Hapi plugin.
 */
export class ApplicationError extends Error {
  constructor({ category, code, message, details, cause, meta } = {}) {
    if (!isSupportedCategory(category)) {
      throw new TypeError(
        `Unsupported application error category: ${String(category)}`
      )
    }

    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new TypeError(
        'ApplicationError requires a non-empty public-safe message'
      )
    }

    super(message)

    const { fallbackCode } = getCategoryDefinition(category)
    const safeCode =
      typeof code === 'string' && code.trim().length > 0 ? code : fallbackCode

    this.name = 'ApplicationError'
    this.category = category
    this.code = safeCode
    this.details = sanitiseDetails(details)

    // `cause` and `meta` are internal diagnostics only. They are defined as non-enumerable so they are
    // never copied by JSON.stringify, Object.keys, object spread, or a naive logging call.
    Object.defineProperty(this, 'cause', {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: false
    })

    Object.defineProperty(this, 'meta', {
      value: meta,
      enumerable: false,
      writable: false,
      configurable: false
    })

    Error.captureStackTrace(this, ApplicationError)
  }

  toJSON() {
    return {
      category: this.category,
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {})
    }
  }
}

export function isApplicationError(value) {
  return value instanceof ApplicationError
}
