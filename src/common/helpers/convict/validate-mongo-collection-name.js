import Joi from 'joi'

// MongoDB collection names: non-empty, no control characters, no `$`, no leading dot/number, bounded
// length, and never the reserved `system.` prefix (case-insensitive). Dots are permitted elsewhere in the
// name (consistent with namespaced collection names such as `fs.chunks`), but are rejected at the start.
const MONGO_COLLECTION_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/

const collectionNameSchema = Joi.string()
  .pattern(MONGO_COLLECTION_NAME_PATTERN)
  .custom((value, helpers) => {
    if (value.toLowerCase().startsWith('system.')) {
      return helpers.error('any.invalid')
    }
    return value
  }, 'reject reserved MongoDB system. prefix')

export const convictValidateMongoCollectionName = {
  name: 'mongo-collection-name',
  validate: function validateMongoCollectionName(value) {
    Joi.assert(value, collectionNameSchema, 'Invalid MongoDB collection name')
  }
}
