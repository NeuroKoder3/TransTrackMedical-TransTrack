/**
 * TransTrack - Structured Logging
 *
 * Provides JSON-structured logging for all Deno edge functions.
 * Ensures sensitive data is redacted and errors are logged safely.
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  [key: string]: unknown;
}

function formatEntry(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
    ...redactSensitiveFields(data || {}),
  };
  return JSON.stringify(entry);
}

const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'ssn', 'social_security',
  'credit_card', 'api_key', 'token', 'secret',
]);

function redactSensitiveFields(data: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function createLogger(context: string) {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      console.debug(formatEntry('DEBUG', context, message, data));
    },
    info(message: string, data?: Record<string, unknown>) {
      console.log(formatEntry('INFO', context, message, data));
    },
    warn(message: string, data?: Record<string, unknown>) {
      console.warn(formatEntry('WARN', context, message, data));
    },
    error(message: string, error?: Error | unknown, data?: Record<string, unknown>) {
      const errorInfo: Record<string, unknown> = { ...data };
      if (error instanceof Error) {
        errorInfo.error_message = error.message;
        errorInfo.error_stack = error.stack;
      } else if (error !== undefined) {
        errorInfo.error_message = String(error);
      }
      console.error(formatEntry('ERROR', context, message, errorInfo));
    },
  };
}

/**
 * Generate a unique request ID for tracking through audit logs.
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Create a safe error response that does not leak internal details.
 */
export function safeErrorResponse(
  requestId: string,
  userMessage: string,
  statusCode = 500
): Response {
  return Response.json(
    {
      error: userMessage,
      request_id: requestId,
    },
    {
      status: statusCode,
      headers: { 'X-Request-ID': requestId },
    }
  );
}
