const SENSITIVE_KEY_PATTERN = /(token|secret|key|authorization|password)/i;
const TOKEN_PATTERNS = [
  /(sk|rk|pk|ck|ak|cu)[-_a-z0-9]{8,}/gi,
  /clickup[_-]?[a-z0-9]{8,}/gi,
  /bearer\s+[a-z0-9._-]{8,}/gi,
  /api(?:key)?\s*[:=]\s*[a-z0-9._-]{8,}/gi,
  /(token|secret|key)\s*[:=]\s*[a-z0-9._-]{8,}/gi
];

function reset(pattern: RegExp): RegExp {
  pattern.lastIndex = 0;
  return pattern;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactString(value: string): string {
  if (!value) {
    return value;
  }
  let result = value;
  for (const pattern of TOKEN_PATTERNS) {
    reset(pattern);
    result = result.replace(pattern, "***REDACTED***");
  }
  return result;
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(entry => redactUnknown(entry));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      if (isSensitiveKey(key)) {
        result[key] = "***REDACTED***";
        continue;
      }
      result[key] = redactUnknown(entry);
    }
    return result;
  }
  return value;
}
