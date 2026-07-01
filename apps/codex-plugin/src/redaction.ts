import type { JsonObject } from './result.js';

function redactUrlString(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value.replace(/([?&]token=)[^&\s]+/giu, '$1REDACTED');
  }

  if (parsed.searchParams.has('token')) {
    parsed.searchParams.set('token', 'REDACTED');
  }

  const nestedUrl = parsed.searchParams.get('url');
  if (nestedUrl) {
    parsed.searchParams.set('url', redactUrlString(nestedUrl));
  }

  return parsed.toString();
}

export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === 'string') return redactUrlString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSecretsDeep(item)) as T;
  if (!value || typeof value !== 'object') return value;

  const redacted: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = redactSecretsDeep(nested);
  }
  return redacted as T;
}

export function redactToolData(data: JsonObject): JsonObject {
  const redacted = redactSecretsDeep(data);
  if (typeof data.url === 'string' && redacted.url !== data.url) {
    redacted.urlRedacted = true;
  }
  if (typeof data.link === 'string' && redacted.link !== data.link) {
    redacted.linkRedacted = true;
  }
  if (typeof data.nativeJoinUrl === 'string' && redacted.nativeJoinUrl !== data.nativeJoinUrl) {
    redacted.nativeJoinUrlRedacted = true;
  }
  return redacted;
}
