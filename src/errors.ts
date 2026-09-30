export class Failure extends Error {
  code: string;
  exitCode: number;
  retryAfter: number | null;
  constructor(message: string, code = 'invalid_response', exitCode = 1, retryAfter: number | null = null) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.retryAfter = retryAfter;
  }
}
