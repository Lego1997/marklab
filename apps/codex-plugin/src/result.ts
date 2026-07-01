export type JsonObject = Record<string, unknown>;

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
  nextStep?: string;
}

export type ToolResult<T extends JsonObject = JsonObject> =
  | { ok: true; data: T }
  | { ok: false; error: ToolError };

export function toolError(code: string, message: string, details?: unknown, nextStep?: string): ToolResult {
  const error: ToolError = { code, message };
  if (details !== undefined) error.details = details;
  if (nextStep !== undefined) error.nextStep = nextStep;
  return { ok: false, error };
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function mapCliEnvelope(envelope: unknown): ToolResult {
  if (!isRecord(envelope) || typeof envelope.ok !== 'boolean') {
    return toolError('invalid_cli_envelope', 'marklab CLI returned a JSON object without an ok boolean.');
  }

  if (envelope.ok === true) {
    const { ok: _ok, ...payload } = envelope;
    return { ok: true, data: payload };
  }

  const code = typeof envelope.code === 'string' ? envelope.code : 'marklab_cli_error';
  const message = typeof envelope.message === 'string' ? envelope.message : 'marklab CLI returned an error.';
  const error: ToolError = { code, message };
  if (Object.hasOwn(envelope, 'details')) error.details = envelope.details;
  if (typeof envelope.nextStep === 'string') error.nextStep = envelope.nextStep;
  return { ok: false, error };
}
