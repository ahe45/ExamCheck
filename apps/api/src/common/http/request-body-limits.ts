// Repeated table rows and embedded images make document templates larger than
// Express's default 100 KB JSON limit. Keep a finite limit for all JSON requests.
export const JSON_BODY_LIMIT_MB = 10;
export const JSON_BODY_LIMIT_BYTES = JSON_BODY_LIMIT_MB * 1024 * 1024;
export const JSON_BODY_TOO_LARGE_MESSAGE =
  `요청 데이터가 허용 용량(${JSON_BODY_LIMIT_MB} MB)을 초과했습니다. ` +
  "이미지나 입력 데이터의 크기를 줄여 다시 시도해 주세요.";
