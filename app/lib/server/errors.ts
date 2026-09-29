/** Someone isn't signed in (401) or isn't allowed to do this (403). Route handlers answer with the status; pages redirect or show the block. */
export class AuthError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
