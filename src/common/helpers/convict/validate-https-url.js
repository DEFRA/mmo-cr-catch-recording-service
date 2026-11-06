import Joi from 'joi'

/**
 * Requires an absolute `https:` URL. No approved design document or repository convention records an
 * exception for a local/test `http:` OpenID Connect metadata endpoint, so none is introduced here —
 * HTTPS is required unconditionally rather than conditionally on environment.
 */
export const convictValidateHttpsUrl = {
  name: 'https-url',
  validate: function validateHttpsUrl(value) {
    const schema = Joi.string().uri({
      scheme: ['https']
    })

    Joi.assert(value, schema, 'must be an absolute https:// URL')
  }
}
