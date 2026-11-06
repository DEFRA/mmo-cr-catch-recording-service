/**
 * Step 02 configuration tests for the Entra/authorization settings added to `src/config.js`. `config.js`
 * validates its schema once at module load (`config.validate({ allowed: 'strict' })`, plus one explicit
 * cross-field check immediately below it) and is otherwise a plain ES module singleton, so each case here
 * isolates its own environment with `vi.stubEnv`/`vi.unstubAllEnvs` and forces a fresh module evaluation
 * with `vi.resetModules()` before a fresh `await import('#/config.js')` - the same pattern already
 * established by `src/common/helpers/start-server.test.js`.
 */

async function loadConfig() {
  vi.resetModules()
  return import('#/config.js')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('#config entra/authorization', () => {
  describe('Valid complete configuration', () => {
    test('Should load successfully with every setting explicitly provided', async () => {
      vi.stubEnv('ENTRA_ISSUER', 'https://entra.example.invalid/tenant/v2.0')
      vi.stubEnv('ENTRA_AUDIENCE', 'api://catch-recording-example')
      vi.stubEnv(
        'ENTRA_OIDC_METADATA_URL',
        'https://entra.example.invalid/.well-known/openid-configuration'
      )
      vi.stubEnv('ENTRA_ALLOWED_ALGORITHMS', 'RS256')
      vi.stubEnv('AUTHORIZATION_ROLES_CLAIM', 'vessel_roles')
      vi.stubEnv('AUTHORIZATION_SERVICE_ID', 'catch-recording')
      vi.stubEnv(
        'USER_PROFILE_SERVICE_URL',
        'https://user-profile.example.invalid'
      )
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_TTL_SECONDS', '600')
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_MAX_STALE_SECONDS', '6000')

      const { config } = await loadConfig()

      expect(config.get('entra')).toEqual({
        issuer: 'https://entra.example.invalid/tenant/v2.0',
        audience: 'api://catch-recording-example',
        oidcMetadataUrl:
          'https://entra.example.invalid/.well-known/openid-configuration',
        allowedAlgorithms: ['RS256']
      })
      expect(config.get('authorization')).toEqual({
        rolesClaim: 'vessel_roles',
        serviceId: 'catch-recording',
        roleDefinitionsUrl: 'https://user-profile.example.invalid',
        roleCacheTtlSeconds: 600,
        roleCacheMaximumStaleSeconds: 6000
      })
    })
  })

  describe('entra.issuer', () => {
    test('Missing - Should load with a null default', async () => {
      const { config } = await loadConfig()
      expect(config.get('entra.issuer')).toBeNull()
    })

    test('Empty - Should throw', async () => {
      vi.stubEnv('ENTRA_ISSUER', '')
      await expect(loadConfig()).rejects.toThrow(/entra.issuer/)
    })
  })

  describe('entra.audience', () => {
    test('Missing - Should load with a null default', async () => {
      const { config } = await loadConfig()
      expect(config.get('entra.audience')).toBeNull()
    })

    test('Empty - Should throw', async () => {
      vi.stubEnv('ENTRA_AUDIENCE', '')
      await expect(loadConfig()).rejects.toThrow(/entra.audience/)
    })
  })

  describe('entra.oidcMetadataUrl', () => {
    test('Missing - Should load with a null default', async () => {
      const { config } = await loadConfig()
      expect(config.get('entra.oidcMetadataUrl')).toBeNull()
    })

    test('Invalid - Should throw', async () => {
      vi.stubEnv('ENTRA_OIDC_METADATA_URL', 'not-a-url')
      await expect(loadConfig()).rejects.toThrow(/entra.oidcMetadataUrl/)
    })

    test('Prohibited non-HTTPS - Should throw', async () => {
      vi.stubEnv(
        'ENTRA_OIDC_METADATA_URL',
        'http://entra.example.invalid/.well-known/openid-configuration'
      )
      await expect(loadConfig()).rejects.toThrow(/entra.oidcMetadataUrl/)
    })
  })

  describe('entra.allowedAlgorithms', () => {
    test('Missing - Should default to RS256', async () => {
      const { config } = await loadConfig()
      expect(config.get('entra.allowedAlgorithms')).toEqual(['RS256'])
    })

    test('Empty - Should throw', async () => {
      vi.stubEnv('ENTRA_ALLOWED_ALGORITHMS', '')
      await expect(loadConfig()).rejects.toThrow(/entra.allowedAlgorithms/)
    })

    test('Unsupported algorithm - Should throw', async () => {
      vi.stubEnv('ENTRA_ALLOWED_ALGORITHMS', 'HS256')
      await expect(loadConfig()).rejects.toThrow(/entra.allowedAlgorithms/)
    })

    test('Valid RS256 - Should load successfully', async () => {
      vi.stubEnv('ENTRA_ALLOWED_ALGORITHMS', 'RS256')
      const { config } = await loadConfig()
      expect(config.get('entra.allowedAlgorithms')).toEqual(['RS256'])
    })
  })

  describe('authorization.rolesClaim', () => {
    test('Missing - Should default to vessel_roles', async () => {
      const { config } = await loadConfig()
      expect(config.get('authorization.rolesClaim')).toBe('vessel_roles')
    })

    test('Empty - Should throw', async () => {
      vi.stubEnv('AUTHORIZATION_ROLES_CLAIM', '')
      await expect(loadConfig()).rejects.toThrow(/authorization.rolesClaim/)
    })
  })

  describe('authorization.serviceId', () => {
    test('Missing - Should default to catch-recording', async () => {
      const { config } = await loadConfig()
      expect(config.get('authorization.serviceId')).toBe('catch-recording')
    })

    test('Empty - Should throw', async () => {
      vi.stubEnv('AUTHORIZATION_SERVICE_ID', '')
      await expect(loadConfig()).rejects.toThrow(/authorization.serviceId/)
    })
  })

  describe('authorization.roleDefinitionsUrl', () => {
    test('Missing - Should load with a null default', async () => {
      const { config } = await loadConfig()
      expect(config.get('authorization.roleDefinitionsUrl')).toBeNull()
    })

    test('Invalid - Should throw', async () => {
      vi.stubEnv('USER_PROFILE_SERVICE_URL', 'not-a-url')
      await expect(loadConfig()).rejects.toThrow(
        /authorization.roleDefinitionsUrl/
      )
    })
  })

  describe('authorization.roleCacheTtlSeconds', () => {
    test('Valid positive value - Should load successfully', async () => {
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_TTL_SECONDS', '900')
      const { config } = await loadConfig()
      expect(config.get('authorization.roleCacheTtlSeconds')).toBe(900)
    })

    test('Zero - Should throw', async () => {
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_TTL_SECONDS', '0')
      await expect(loadConfig()).rejects.toThrow(
        /authorization.roleCacheTtlSeconds/
      )
    })

    test('Negative - Should throw', async () => {
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_TTL_SECONDS', '-1')
      await expect(loadConfig()).rejects.toThrow(
        /authorization.roleCacheTtlSeconds/
      )
    })

    test('Non-integer - Should throw', async () => {
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_TTL_SECONDS', '600.5')
      await expect(loadConfig()).rejects.toThrow(
        /authorization.roleCacheTtlSeconds/
      )
    })
  })

  describe('authorization.roleCacheMaximumStaleSeconds', () => {
    test('Less than TTL - Should throw', async () => {
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_TTL_SECONDS', '600')
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_MAX_STALE_SECONDS', '100')
      await expect(loadConfig()).rejects.toThrow(
        /roleCacheMaximumStaleSeconds must be greater than or equal to/
      )
    })

    test('Valid (equal to TTL) - Should load successfully', async () => {
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_TTL_SECONDS', '600')
      vi.stubEnv('AUTHORIZATION_ROLE_CACHE_MAX_STALE_SECONDS', '600')
      const { config } = await loadConfig()
      expect(config.get('authorization.roleCacheMaximumStaleSeconds')).toBe(600)
    })

    test('Valid (greater than TTL, approved defaults) - Should load successfully', async () => {
      const { config } = await loadConfig()
      expect(config.get('authorization.roleCacheTtlSeconds')).toBe(600)
      expect(config.get('authorization.roleCacheMaximumStaleSeconds')).toBe(
        6000
      )
    })
  })

  describe('Sanitised startup errors', () => {
    test('Should name the failing configuration key without dumping the full config', async () => {
      vi.stubEnv(
        'ENTRA_OIDC_METADATA_URL',
        'http://entra.example.invalid/.well-known/openid-configuration'
      )

      await expect(loadConfig()).rejects.toThrow('entra.oidcMetadataUrl')

      try {
        await loadConfig()
        expect.unreachable('loadConfig() should have thrown')
      } catch (error) {
        expect(error.message).not.toMatch(/Bearer /)
        expect(error.message).not.toMatch(/mongoUrl/)
        expect(error.message.length).toBeLessThan(500)
      }
    })
  })

  describe('Existing configuration regression', () => {
    test('Should still load pre-existing keys unchanged', async () => {
      const { config } = await loadConfig()

      expect(config.get('host')).toBe('0.0.0.0')
      expect(config.get('port')).toBe(3001)
      // `mongo.mongoUrl`'s runtime value is overridden by the shared `vitest-mongodb` test setup
      // (`.vite/mongo-memory-server.js`); only its shape - not the default - is a stable assertion here.
      expect(config.get('mongo.mongoUrl')).toMatch(/^mongodb:\/\//)
      expect(config.get('authentication.baseUrl')).toBeNull()
      expect(config.get('referenceData.baseUrl')).toBeNull()
    })
  })
})
