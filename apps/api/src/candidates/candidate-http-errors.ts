import { BadRequestException, ConflictException } from "@nestjs/common";
import { CandidateDomainError } from "./candidate-domain.js";
import { CandidatePreviewTicketError } from "./candidate-preview-ticket.js";

export function toCandidateHttpError(error: unknown): unknown {
  if (error instanceof CandidateDomainError) return new BadRequestException(error.message);
  if (!(error instanceof CandidatePreviewTicketError)) return error;
  if (error.reason === "INVALID") {
    return new BadRequestException("유효한 미리보기가 필요합니다. 파일을 다시 선택해 주세요.");
  }
  if (error.reason === "EXPIRED") {
    return new ConflictException("미리보기 유효 시간이 만료되었습니다. 파일을 다시 선택해 주세요.");
  }
  if (error.reason === "FILE_CHANGED") {
    return new ConflictException("미리보기 이후 선택한 파일이 변경되었습니다. 파일을 다시 선택해 주세요.");
  }
  return new ConflictException(
    "미리보기 이후 수험생 데이터가 변경되었습니다. 파일을 다시 선택해 미리보기를 갱신해 주세요.",
  );
}
