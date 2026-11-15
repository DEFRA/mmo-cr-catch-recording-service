import { vi } from 'vitest'

import {
  createFetchStub,
  createTestSigningKey,
  TEST_JWKS_URI
} from './entra-test-fixtures.js'
import { createJwksClient } from './jwks-client.js'
import { SigningKeyFailure } from './signing-key-failure.js'

vi.mock('jose', async (importOriginal) => ({
  ...(await importOriginal()),
  importJWK: vi.fn().mockRejectedValue(new Error('unsupported key'))
}))

describe('#createJwksClient key import failure', () => {
  test('Should not make a key usable when the library cannot import it', async () => {
    const key = await createTestSigningKey('kid-a')
    const client = createJwksClient({
      timeoutMs: 1000,
      allowedAlgorithms: ['RS256'],
      fetchFn: createFetchStub({
        [TEST_JWKS_URI]: { json: { keys: [key.publicJwk] } }
      })
    })

    await expect(client.fetchSigningKeys(TEST_JWKS_URI)).rejects.toMatchObject({
      reason: SigningKeyFailure.NO_USABLE_SIGNING_KEYS
    })
  })
})
