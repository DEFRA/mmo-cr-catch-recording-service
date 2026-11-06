export const convictValidateNonEmptyString = {
  name: 'non-empty-string',
  validate: function validateNonEmptyString(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('must be a non-empty string')
    }
  }
}
