/**
 * Deterministic, allow-list detail sanitiser for public error responses.
 *
 * Only these fields are ever permitted into a public response, per
 * `design/architecture/catch-recording-error-handling.md` §5. Anything else — including raw Joi
 * context, submitted values, or arbitrary caller-added properties — is silently omitted rather than
 * copied. The input is never mutated; a fresh array of fresh plain objects is always returned.
 */

const ALLOWED_STRING_FIELDS = ['code', 'message', 'format']
const ALLOWED_NUMBER_FIELDS = ['min', 'max']

function toSafePath(path) {
  if (typeof path === 'string') {
    return path
  }

  if (Array.isArray(path)) {
    const safeSegments = path.filter(
      (segment) => typeof segment === 'string' || typeof segment === 'number'
    )

    return safeSegments.length > 0 ? safeSegments.join('.') : undefined
  }

  return undefined
}

function toSafeAllowedValues(allowedValues) {
  if (!Array.isArray(allowedValues)) {
    return undefined
  }

  const safeValues = allowedValues.filter(
    (value) =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
  )

  return safeValues.length > 0 ? safeValues : undefined
}

function assignSafePath(safeDetail, rawDetail) {
  if (!Object.hasOwn(rawDetail, 'path')) {
    return
  }

  const safePath = toSafePath(rawDetail.path)
  if (safePath !== undefined) {
    safeDetail.path = safePath
  }
}

function assignIfSafeType(safeDetail, rawDetail, field, isSafeType) {
  if (Object.hasOwn(rawDetail, field) && isSafeType(rawDetail[field])) {
    safeDetail[field] = rawDetail[field]
  }
}

function assignSafeAllowedValues(safeDetail, rawDetail) {
  if (!Object.hasOwn(rawDetail, 'allowedValues')) {
    return
  }

  const safeAllowedValues = toSafeAllowedValues(rawDetail.allowedValues)
  if (safeAllowedValues !== undefined) {
    safeDetail.allowedValues = safeAllowedValues
  }
}

function isString(value) {
  return typeof value === 'string'
}

function isNumber(value) {
  return typeof value === 'number'
}

function sanitiseDetail(rawDetail) {
  if (
    typeof rawDetail !== 'object' ||
    rawDetail === null ||
    Array.isArray(rawDetail)
  ) {
    return undefined
  }

  const safeDetail = {}

  assignSafePath(safeDetail, rawDetail)

  for (const field of ALLOWED_STRING_FIELDS) {
    assignIfSafeType(safeDetail, rawDetail, field, isString)
  }

  for (const field of ALLOWED_NUMBER_FIELDS) {
    assignIfSafeType(safeDetail, rawDetail, field, isNumber)
  }

  assignSafeAllowedValues(safeDetail, rawDetail)

  return Object.keys(safeDetail).length > 0
    ? Object.freeze(safeDetail)
    : undefined
}

export function sanitiseDetails(details) {
  if (!Array.isArray(details)) {
    return undefined
  }

  const safeDetails = details
    .map((rawDetail) => sanitiseDetail(rawDetail))
    .filter((safeDetail) => safeDetail !== undefined)

  return safeDetails.length > 0 ? Object.freeze(safeDetails) : undefined
}
