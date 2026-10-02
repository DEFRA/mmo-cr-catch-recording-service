// Allow-lists safe structured error details (Step 03). Only these fields are ever copied from a supplied
// detail object into the public payload — arbitrary properties (including `__proto__`, submitted values,
// stack traces, or internal identifiers) are never copied, because only these fixed field names are ever
// read from the caller-supplied object.
const ALLOWED_DETAIL_FIELDS = Object.freeze([
  'path',
  'code',
  'message',
  'min',
  'max',
  'format',
  'allowedValues'
])

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeDetail(detail) {
  if (!isPlainObject(detail)) {
    return null
  }

  const safeDetail = {}
  for (const field of ALLOWED_DETAIL_FIELDS) {
    if (Object.hasOwn(detail, field) && detail[field] !== undefined) {
      safeDetail[field] = detail[field]
    }
  }

  return Object.keys(safeDetail).length > 0 ? Object.freeze(safeDetail) : null
}

// Returns a frozen array of frozen, allow-listed detail objects. Never mutates the supplied `details`.
// Invalid or unsafe entries are silently dropped rather than thrown, so detail sanitisation itself can
// never cause a mapping failure.
export function buildSafeDetails(details) {
  if (!Array.isArray(details)) {
    return Object.freeze([])
  }

  const safeDetails = details
    .map(sanitizeDetail)
    .filter((detail) => detail !== null)

  return Object.freeze(safeDetails)
}
