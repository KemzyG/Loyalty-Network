import type { ProtocolErrorCode } from "./types.js";

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ProtocolError";
    this.code = code;
  }
}
