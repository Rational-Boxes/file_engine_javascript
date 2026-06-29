/**
 * Typed errors for the FileEngine client.
 *
 * Failures surface as informative exceptions instead of falsy returns. Every
 * error derives from {@link FileEngineError}, which carries structured context —
 * the high-level `operation`, the target `uid`, the gRPC `statusCode` (when the
 * failure was a transport-level error), and the server-supplied `serverError`
 * message. The `transient` flag tells a caller whether retrying is reasonable:
 * it is `true` for availability errors raised during a primary-database failover
 * (the service is temporarily read-only) or when the server is unreachable.
 *
 * Hierarchy:
 *   FileEngineError
 *   ├── ServerUnreachableError      transient — transport failure / timeout
 *   ├── ServiceUnavailableError     transient — server up but cannot serve
 *   │   └── WriteUnavailableError   transient — write rejected: read-only failover
 *   ├── AuthenticationError
 *   ├── PermissionDeniedError
 *   ├── NotFoundError
 *   ├── AlreadyExistsError
 *   ├── InvalidRequestError
 *   └── OperationError
 */
import * as grpc from '@grpc/grpc-js';

export interface ErrorContext {
  operation?: string;
  uid?: string;
  /** Numeric gRPC status code for transport-level failures. */
  statusCode?: number;
  /** Raw error string returned by the server, if any. */
  serverError?: string;
}

export class FileEngineError extends Error {
  readonly operation?: string;
  readonly uid?: string;
  readonly statusCode?: number;
  readonly serverError?: string;
  /** True if the condition is expected to clear (retry is reasonable). */
  readonly transient: boolean = false;

  constructor(message: string, ctx: ErrorContext = {}) {
    super(FileEngineError.format(message, ctx));
    this.name = new.target.name;
    this.operation = ctx.operation;
    this.uid = ctx.uid;
    this.statusCode = ctx.statusCode;
    this.serverError = ctx.serverError;
    // Restore prototype chain (TS-down-to-ES5/ES2020 `extends Error` caveat).
    Object.setPrototypeOf(this, new.target.prototype);
  }

  private static format(message: string, ctx: ErrorContext): string {
    const parts: string[] = [];
    if (ctx.operation) parts.push(`op=${ctx.operation}`);
    if (ctx.uid) parts.push(`uid=${ctx.uid}`);
    if (ctx.statusCode !== undefined) parts.push(`grpc=${ctx.statusCode}`);
    return parts.length ? `${message} (${parts.join(', ')})` : message;
  }
}

// --- availability (transient — safe to retry) ---------------------------- //
export class ServerUnreachableError extends FileEngineError {
  override readonly transient = true;
}
export class ServiceUnavailableError extends FileEngineError {
  override readonly transient = true;
}
export class WriteUnavailableError extends ServiceUnavailableError {
  override readonly transient = true;
}

// --- authentication / authorization -------------------------------------- //
export class AuthenticationError extends FileEngineError {}
export class PermissionDeniedError extends FileEngineError {}

// --- request / state ----------------------------------------------------- //
export class NotFoundError extends FileEngineError {}
export class AlreadyExistsError extends FileEngineError {}
export class InvalidRequestError extends FileEngineError {}
export class OperationError extends FileEngineError {}

type ErrCtor = new (message: string, ctx?: ErrorContext) => FileEngineError;

const STATUS_MAP: { [code: number]: ErrCtor } = {
  [grpc.status.UNAVAILABLE]: ServerUnreachableError,
  [grpc.status.DEADLINE_EXCEEDED]: ServerUnreachableError,
  [grpc.status.UNAUTHENTICATED]: AuthenticationError,
  [grpc.status.PERMISSION_DENIED]: PermissionDeniedError,
  [grpc.status.NOT_FOUND]: NotFoundError,
  [grpc.status.ALREADY_EXISTS]: AlreadyExistsError,
  [grpc.status.INVALID_ARGUMENT]: InvalidRequestError,
  [grpc.status.RESOURCE_EXHAUSTED]: InvalidRequestError,
};

/** Translate a gRPC ServiceError into the matching typed error (always throws). */
export function raiseRpc(err: grpc.ServiceError, operation: string, uid?: string): never {
  const code = err.code;
  let cls: ErrCtor = FileEngineError;
  if (code !== undefined && STATUS_MAP[code]) cls = STATUS_MAP[code];
  else if (code === grpc.status.INTERNAL) cls = ServiceUnavailableError;
  const detail = (err.details || err.message || '').trim() || `code ${code}`;
  throw new cls(`gRPC ${operation} failed: ${detail}`, {
    operation, uid, statusCode: code, serverError: err.details,
  });
}

/** Pick the error class for a server-reported `error` string, or null. */
export function classifyServerError(message: string): ErrCtor | null {
  const low = (message || '').toLowerCase();
  if (low.includes('read-only') || low.includes('readonly')) return WriteUnavailableError;
  if (low.includes('unavailable')) return ServiceUnavailableError;
  if (low.includes('permission') || low.includes('not authorized')
      || low.includes('forbidden') || low.includes('access denied')) return PermissionDeniedError;
  if (low.includes('not found') || low.includes('does not exist')
      || low.includes('no such') || low.includes("doesn't exist")) return NotFoundError;
  if (low.includes('already exists')) return AlreadyExistsError;
  if (low.includes('no file data') || low.includes('invalid')
      || low.includes('malformed')) return InvalidRequestError;
  return null;
}

/**
 * Throw a typed error if `resp.success` is false; otherwise return resp.
 * `defaultCls` is used when the server error string matches no known pattern
 * (e.g. NotFoundError for stat/get-style reads).
 */
export function checkResponse<T extends { success?: boolean; error?: string }>(
  resp: T, operation: string, uid?: string, defaultCls: ErrCtor = OperationError,
): T {
  if (resp.success === undefined || resp.success) return resp;
  const serverError = (resp.error || '').trim();
  const cls = classifyServerError(serverError) || defaultCls;
  throw new cls(serverError || `${operation} failed`, {
    operation, uid, serverError: serverError || undefined,
  });
}
