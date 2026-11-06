import Joi from 'joi'

/**
 * Requires an absolute `http:`/`https:` URL. Deliberately stricter than convict-format-with-validator's
 * built-in `url` format (which accepts a bare unscoped string such as `not-a-url` when `require_tld:
 * false`, confirmed empirically against the installed `validator` version) - the approved design requires
 * an invalid role-definition base URL to be rejected. Both schemes are permitted (unlike `https-url`)
 * because the User Profile Service base URL, like `authentication.baseUrl`/`referenceData.baseUrl`, may
 * run over plain HTTP in local/test environments.
 */
export const convictValidateBaseUrl = {
  name: 'base-url',
  validate: function validateBaseUrl(value) {
    const schema = Joi.string().uri({
      scheme: ['http', 'https']
    })

    Joi.assert(value, schema, 'must be an absolute http:// or https:// URL')
  }
}
