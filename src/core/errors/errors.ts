export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request", details?: unknown) {
    super(400, "validation_failed", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not permitted") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, "conflict", message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable") {
    super(503, "service_unavailable", message);
  }
}

export class UpstreamError extends Error {
  constructor(
    public readonly system: string,
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class TimeoutError extends Error {
  constructor(
    public readonly label: string,
    public readonly timeoutMs: number,
  ) {
    super(`${label} timed out after ${timeoutMs} ms`);
    this.name = "TimeoutError";
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly system: string) {
    super(`Circuit for ${system} is open`);
    this.name = "CircuitOpenError";
  }
}

export class RateLimitedError extends Error {
  constructor(
    public readonly system: string,
    public readonly retryAfterMs: number,
  ) {
    super(`Rate limit for ${system} reached`);
    this.name = "RateLimitedError";
  }
}

export class SchemaError extends Error {
  constructor(
    public readonly system: string,
    public readonly issues: string[],
  ) {
    super(`${system} response failed validation: ${issues.join("; ")}`);
    this.name = "SchemaError";
  }
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof TimeoutError || error instanceof RateLimitedError) return true;
  if (error instanceof UpstreamError) return error.status === 0 || error.status === 429 || error.status >= 500;
  return false;
}
