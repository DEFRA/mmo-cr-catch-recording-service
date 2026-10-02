// Asserts that every configured Catch Recording persistence collection name is unique. Convict's
// per-field `format` validation cannot see sibling values, so this cross-field check runs explicitly in
// src/config.js immediately after `config.validate({ allowed: 'strict' })`.
//
// Throws a plain Error (never ApplicationError or Boom) — configuration failures are startup failures,
// kept independent of the Step 03 request-time HTTP error model.
export function assertUniqueCollectionNames(collections) {
  const seen = new Map()
  const duplicates = new Set()

  for (const [key, name] of Object.entries(collections)) {
    if (seen.has(name)) {
      duplicates.add(name)
    } else {
      seen.set(name, key)
    }
  }

  if (duplicates.size > 0) {
    const duplicateNames = [...duplicates].join(', ')
    throw new Error(
      `Catch Recording persistence collection names must be unique. Duplicate name(s): ${duplicateNames}`
    )
  }
}
