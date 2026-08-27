import { BadRequestException, ConflictException } from "@nestjs/common";
import { PseudonymDomainError } from "./pseudonym-domain.js";

export function toPseudonymHttpError(error: unknown): unknown {
  if (!(error instanceof PseudonymDomainError)) return error;
  return error.kind === "CONFLICT" ? new ConflictException(error.message) : new BadRequestException(error.message);
}
