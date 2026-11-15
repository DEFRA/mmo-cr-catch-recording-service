import { afterEach, vi } from 'vitest'

const ENV_KEYS = [
  'NODE_ENV',
  'ENVIRONMENT',
  'ENTRA_ISSUER',
  'ENTRA_AUDIENCE',
  'ENTRA_OIDC_METADATA_URL',
  'ENTRA_ALLOWED_ALGORITHMS',
  'ENTRA_USER_ID_CLAIM',
  'ENTRA_METADATA_REFRESH_INTERVAL_SECONDS',
  'ENTRA_MINIMUM_REFRESH_INTERVAL_SECONDS',
  'ENTRA_REQUEST_TIMEOUT_MS',
  'AUTHORIZATION_USER_ROLES_URL_TEMPLATE',
  'AUTHORIZATION_ROLE_DEFINITIONS_URL',
  'AUTHORIZATION_USER_ROLE_CACHE_MAXIMUM_ENTRIES',
  'AUTHORIZATION_ROLE_DEFINITIONS_CACHE_TTL_SECONDS',
  'AUTHORIZATION_ROLE_DEFINITIONS_CACHE_MAXIMUM_STALE_SECONDS'
]
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
)

const loadConfig = async (env) => {
  vi.resetModules()
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
  Object.assign(process.env, env)
  return (await import('./config.js')).config
}

describe('#config Entra and authorization settings', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
    vi.resetModules()
  })

  test('Should load a complete synthetic configuration under test with the approved 300 second user-role TTL', async () => {
    const config = await loadConfig({ NODE_ENV: 'test' })

    expect(config.get('entra.allowedAlgorithms')).toEqual(['RS256'])
    expect(config.get('entra.issuer')).toContain('.invalid')
    expect(config.get('authorization.userRoleCacheTtlSeconds')).toBe(300)
    expect(config.get('authorization.serviceId')).toBe('catch-recording')
  })

  test('Should map environment variables onto the configuration', async () => {
    const config = await loadConfig({
      NODE_ENV: 'test',
      ENTRA_USER_ID_CLAIM: 'sub',
      ENTRA_ALLOWED_ALGORITHMS: 'RS256',
      AUTHORIZATION_USER_ROLE_CACHE_MAXIMUM_ENTRIES: '25'
    })

    expect(config.get('entra.userIdClaim')).toBe('sub')
    expect(config.get('authorization.userRoleCacheMaximumEntries')).toBe(25)
  })

  test('Should fail startup when a provided value is invalid', async () => {
    await expect(
      loadConfig({ NODE_ENV: 'test', ENTRA_ISSUER: '   ' })
    ).rejects.toThrow('entra.issuer')
  })

  test('Should fail startup for an unsupported signing algorithm', async () => {
    await expect(
      loadConfig({ NODE_ENV: 'test', ENTRA_ALLOWED_ALGORITHMS: 'HS256' })
    ).rejects.toThrow('entra.allowedAlgorithms')
  })

  test('Should fail startup in a deployed environment when required values are not supplied', async () => {
    await expect(
      loadConfig({ NODE_ENV: 'development', ENVIRONMENT: 'dev' })
    ).rejects.toThrow('Invalid Entra/authorization configuration')
  })

  test('Should still start for local development when nothing is configured', async () => {
    const config = await loadConfig({ NODE_ENV: 'development' })

    expect(config.get('entra.issuer')).toBeNull()
  })
})
