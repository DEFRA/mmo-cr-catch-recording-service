import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

/**
 * Loads the one committed OpenAPI 3.1 contract (`src/openapi/openapi.yaml`) once, at module load time,
 * and exposes it in both of its public representations:
 *
 * - `openApiContractYaml` — the raw committed YAML text, served as-is by `GET /openapi.yaml`.
 * - `openApiContractJson` — the same file parsed to a plain JS object via the `yaml` package, served
 *   as JSON by `GET /openapi.json`.
 *
 * Both exports always describe exactly the same committed source, so the two runtime endpoints can
 * never disagree with each other or with the version-controlled contract. The file is resolved
 * relative to this module's own location (`import.meta.url`), not `process.cwd()`, so it works
 * regardless of the directory the process is started from.
 */

const CONTRACT_PATH = fileURLToPath(new URL('./openapi.yaml', import.meta.url))

export const openApiContractYaml = readFileSync(CONTRACT_PATH, 'utf8')

export const openApiContractJson = parse(openApiContractYaml)
