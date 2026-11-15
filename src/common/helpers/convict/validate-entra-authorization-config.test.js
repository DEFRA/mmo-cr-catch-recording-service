import { validateEntraAuthorizationConfig } from './validate-entra-authorization-config.js'

const validConfig = () => ({
  entra: {
    issuer: 'https://login.entra.test.invalid/test-tenant/v2.0',
    audience: 'api://catch-recording-test',
    oidcMetadataUrl:
      'https://login.entra.test.invalid/test-tenant/v2.0/.well-known/openid-configuration',
    allowedAlgorithms: ['RS256'],
    userIdClaim: 'oid',
    metadataRefreshIntervalSeconds: 3600,
    minimumRefreshIntervalSeconds: 60,
    requestTimeoutMs: 2000
  },
  authorization: {
    serviceId: 'catch-recording',
    userRolesUrlTemplate:
      'https://user-profile.test.invalid/users/{entraObjectId}/roles',
    roleDefinitionsUrl:
      'https://user-profile.test.invalid/roles-definitions/services/catch-recording',
    userRoleCacheTtlSeconds: 300,
    userRoleCacheMaximumEntries: 100,
    roleDefinitionsCacheTtlSeconds: 60,
    roleDefinitionsCacheMaximumStaleSeconds: 300,
    userProfileRequestTimeoutMs: 2000,
    userProfileRetryCount: 1,
    userProfileRetryDelayMs: 100
  }
})

const deployed = { isLocalRuntime: false }
const local = { isLocalRuntime: true }

const withEntra = (overrides) => {
  const value = validConfig()
  Object.assign(value.entra, overrides)
  return value
}
const withAuthorization = (overrides) => {
  const value = validConfig()
  Object.assign(value.authorization, overrides)
  return value
}

describe('#validateEntraAuthorizationConfig', () => {
  describe('valid configuration', () => {
    test('Should accept a complete configuration with RS256 and a 300 second user-role TTL', () => {
      expect(() =>
        validateEntraAuthorizationConfig(validConfig(), deployed)
      ).not.toThrow()
    })

    test('Should accept http URLs only for local runtime', () => {
      const value = withEntra({ oidcMetadataUrl: 'http://localhost:3010/oidc' })
      value.entra.issuer = 'http://localhost:3010/'

      expect(() => validateEntraAuthorizationConfig(value, local)).not.toThrow()
      expect(() => validateEntraAuthorizationConfig(value, deployed)).toThrow(
        'entra.oidcMetadataUrl must be an absolute https URL'
      )
    })

    test('Should tolerate a fully unset configuration only for local runtime', () => {
      const unset = {
        entra: {
          issuer: null,
          audience: null,
          oidcMetadataUrl: null,
          allowedAlgorithms: ['RS256'],
          userIdClaim: null,
          metadataRefreshIntervalSeconds: null,
          minimumRefreshIntervalSeconds: null,
          requestTimeoutMs: null
        },
        authorization: {
          ...validConfig().authorization,
          userRolesUrlTemplate: null,
          roleDefinitionsUrl: null,
          userRoleCacheMaximumEntries: null,
          roleDefinitionsCacheTtlSeconds: null,
          roleDefinitionsCacheMaximumStaleSeconds: null
        }
      }

      expect(() => validateEntraAuthorizationConfig(unset, local)).not.toThrow()
      expect(() => validateEntraAuthorizationConfig(unset, deployed)).toThrow(
        'Invalid Entra/authorization configuration'
      )
    })

    test('Should reject a partially set configuration even for local runtime', () => {
      const partial = withEntra({
        issuer: null,
        audience: null,
        oidcMetadataUrl: null
      })

      expect(() => validateEntraAuthorizationConfig(partial, local)).toThrow(
        'entra.issuer must be a non-empty string'
      )
    })
  })

  describe('invalid Entra configuration', () => {
    test.each([
      ['issuer', null],
      ['issuer', ''],
      ['issuer', '   '],
      ['issuer', 'https://login.entra.test.invalid/*/v2.0'],
      ['issuer', 'not-a-url'],
      ['audience', null],
      ['audience', ''],
      ['audience', '*'],
      ['oidcMetadataUrl', null],
      ['oidcMetadataUrl', 'not-a-url'],
      ['oidcMetadataUrl', 'ftp://login.entra.test.invalid/oidc'],
      ['oidcMetadataUrl', 'https://user:pass@login.entra.test.invalid/oidc'],
      ['userIdClaim', null],
      ['userIdClaim', ''],
      ['userIdClaim', 'oid sub'],
      ['userIdClaim', '*'],
      ['allowedAlgorithms', []],
      ['allowedAlgorithms', ['none']],
      ['allowedAlgorithms', ['RS256', 'HS256']],
      ['allowedAlgorithms', ['RS256', 'RS256']],
      ['metadataRefreshIntervalSeconds', 0],
      ['metadataRefreshIntervalSeconds', -1],
      ['minimumRefreshIntervalSeconds', 0],
      ['minimumRefreshIntervalSeconds', 3601],
      ['requestTimeoutMs', 0]
    ])('Should reject entra.%s = %j', (field, value) => {
      expect(() =>
        validateEntraAuthorizationConfig(
          withEntra({ [field]: value }),
          deployed
        )
      ).toThrow(`entra.${field}`)
    })
  })

  describe('invalid authorization configuration', () => {
    test.each([
      ['serviceId', null],
      ['serviceId', ''],
      ['serviceId', 'Catch Recording'],
      ['userRolesUrlTemplate', null],
      ['userRolesUrlTemplate', 'https://user-profile.test.invalid/users/roles'],
      ['userRolesUrlTemplate', 'not-a-url/{entraObjectId}'],
      [
        'userRolesUrlTemplate',
        'https://user-profile.test.invalid/{entraObjectId}/{entraObjectId}'
      ],
      ['userRolesUrlTemplate', 'https://{entraObjectId}.test.invalid/roles'],
      [
        'userRolesUrlTemplate',
        'https://user-profile.test.invalid/roles?id={entraObjectId}'
      ],
      ['roleDefinitionsUrl', null],
      ['roleDefinitionsUrl', 'not-a-url'],
      [
        'roleDefinitionsUrl',
        'https://user-profile.test.invalid/roles-definitions/services/other'
      ],
      ['userRoleCacheTtlSeconds', 0],
      ['userRoleCacheTtlSeconds', -5],
      ['userRoleCacheMaximumEntries', 0],
      ['userRoleCacheMaximumEntries', null],
      ['roleDefinitionsCacheTtlSeconds', 0],
      ['roleDefinitionsCacheMaximumStaleSeconds', 0],
      ['roleDefinitionsCacheMaximumStaleSeconds', 1.5],
      ['roleDefinitionsCacheMaximumStaleSeconds', Number.MAX_SAFE_INTEGER],
      ['userProfileRequestTimeoutMs', 0],
      ['userProfileRetryCount', -1],
      ['userProfileRetryDelayMs', -1]
    ])('Should reject authorization.%s = %j', (field, value) => {
      expect(() =>
        validateEntraAuthorizationConfig(
          withAuthorization({ [field]: value }),
          deployed
        )
      ).toThrow(`authorization.${field}`)
    })

    test('Should report every invalid field without echoing configured values', () => {
      const value = withEntra({ audience: 'secret-looking-audience*' })
      value.authorization.userRoleCacheTtlSeconds = 0

      let message
      try {
        validateEntraAuthorizationConfig(value, deployed)
      } catch (error) {
        message = error.message
      }

      expect(message).toContain('entra.audience')
      expect(message).toContain('authorization.userRoleCacheTtlSeconds')
      expect(message).not.toContain('secret-looking-audience')
    })
  })
})
