// Deterministic redaction of secrets from any string, error, or object before it
// can reach a log, exception, or the agent boundary. When in doubt, redact.

const REDACTED = '[REDACTED]'

const SECRET_PATTERNS = [
  /Basic\s+[A-Za-z0-9+/=]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /(api_token|token|password|secret)=([^&\s"']+)/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
]

const SECRET_KEYS = new Set([
  'authorization', 'token', 'apitoken', 'api_token', 'password', 'secret',
  'cookie', 'email', 'emailaddress'
])

export function redactString (value) {
  if (typeof value !== 'string') return value
  let out = value
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, p1) => (p1 && /^[a-z_]+$/i.test(p1) ? `${p1}=${REDACTED}` : REDACTED))
  }
  return out
}

export function redact (input, seen = new WeakSet()) {
  if (input == null) return input
  if (typeof input === 'string') return redactString(input)
  if (typeof input !== 'object') return input
  if (seen.has(input)) return '[Circular]'
  seen.add(input)
  if (Array.isArray(input)) return input.map((item) => redact(item, seen))
  const out = {}
  for (const [key, val] of Object.entries(input)) {
    out[key] = SECRET_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, seen)
  }
  return out
}

// An Error whose message is always redacted. Throw this instead of raw errors
// that might carry secrets or PII.
export class SafeError extends Error {
  constructor (message, { code = 'ERR_SAFE' } = {}) {
    super(redactString(String(message)))
    this.name = 'SafeError'
    this.code = code
  }
}
