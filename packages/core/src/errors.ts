/**
 * Application errors thrown by services and mapped to HTTP responses by the
 * global error handler (see server.ts). Services stay HTTP-agnostic in spirit:
 * they pick the error *kind*; only the handler turns it into a response.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "bad request") {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "unauthorized") {
    super(401, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "not found") {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "conflict") {
    super(409, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(
    message = "too many requests",
    /** Seconds until the client may retry (sent as Retry-After). */
    readonly retryAfterSeconds?: number,
  ) {
    super(429, message);
  }
}
