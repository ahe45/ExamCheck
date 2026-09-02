# 목표 데이터 모델 외부 결정 기록부

> 상태: D-01~D-22 원칙 승인 완료
>
> 승인자: 사용자
>
> 승인일: 2026-08-28
>
> 적용 범위: 목표 identity 모델(`027+`)
>
> 제안 근거: `docs/adr/0002-target-identity-model-proposal.md`
>
> 실행 게이트: `docs/data-model-cutover-gates.md`

이 문서는 목표 identity 모델과 운영 전환에 필요한 D-01~D-22 결정을 기록한다. revision 2에서
사용자가 권장안을 모두 승인했다. 이 승인은 목표 모델 설계·migration 작성·비운영 검증을 진행할
권한이며, 개인정보 backup/restore, 운영 backfill, read/write cutover, legacy contract는 각 실행
게이트의 별도 증거와 승인을 요구한다.

## 승인 규칙

- 결정 변경은 기존 내용을 지우지 않고 revision을 올려 변경 이유와 영향 범위를 남긴다.
- 개인정보 원문이나 실제 수험번호·가번호 예시는 기록하지 않는다.
- 보존 기간, expiry, 관찰 기간·처리량·성능 임계치처럼 구체 숫자가 승인되지 않은 항목은
  **원칙 승인/세부 운영값 별도 확정**으로 표시하며 코드 기본값이나 운영 전환 조건으로 추정하지 않는다.

## 결정표

모든 행의 책임자·승인자는 `사용자`, 승인일은 `2026-08-28`, 적용 범위는 `목표 모델`이다.

| ID   | 결정 주제              | 상태      | 승인된 결정                                                                                                                                                       | 예외·후속 운영값                                                                                |
| ---- | ---------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D-01 | 시험 주기 identity     | 원칙 승인 | `exam_cycle → admission → operation_slot → schedule_segment` 계층을 사용하고 모든 관계는 내부 ID를 유지한다.                                                      | 불변 `cycle_code` 생성 원본, 표시명, 시작·종료일과 active 전환 절차는 운영값으로 별도 확정한다. |
| D-02 | 수험번호 `SYSTEM` 범위 | 승인      | 목표 모델의 `SYSTEM`은 DB 전체 수명이 아니라 `exam_cycle` 범위다.                                                                                                 | 현 모델의 전역 의미는 compatibility 기간에만 보존하며 cycle 간 충돌은 dry-run으로 보고한다.     |
| D-03 | 동일 수험번호 identity | 승인      | 같은 cycle의 동일 canonical 수험번호는 같은 `candidate`이고 복수 교시는 복수 `candidate_registration`으로 표현한다. 이름·생년월일 충돌은 덮지 않고 격리한다.      | exact 1건이 아닌 인적정보 매핑은 quarantine한다.                                                |
| D-04 | 전형 identity          | 원칙 승인 | 표시 이름은 수정 가능한 값이며 내부 `admission.id`는 유지한다. 코드가 없으면 정규화 이름 alias로 최초 매핑한다.                                                   | 외부 source code 도입 일정과 alias 승인 절차는 별도 운영값이다.                                 |
| D-05 | 교시 identity          | 원칙 승인 | slot identity는 `전형 + 날짜 + 시작시간 + 교시 identity`이고 종료시간·건물·고사실은 제외한다.                                                                     | 교시 코드가 없으면 이름 alias를 사용한다. timezone과 코드 도입 절차는 별도 운영값이다.          |
| D-06 | 세부 일정 identity     | 승인      | segment identity는 한 slot 안의 `모집단위 + 전공 + 건물 + 고사실` canonical tuple이다. 빈 optional 값은 `NULL`, 필수 값은 오류로 처리한다.                        | 공란 코드를 임의 생성하지 않으며 향후 코드 도입 시 같은 내부 ID를 유지한다.                     |
| D-07 | 수험번호 정규화        | 원칙 승인 | 문자열에 NFKC와 trim을 적용하고 선행 0과 표시값을 보존한다. binary canonical 값으로 비교한다.                                                                     | 허용 문자와 최대 길이는 진단 후 별도 확정한다. 제어 문자는 허용하지 않는다.                     |
| D-08 | 가번호 정규화          | 원칙 승인 | 양의 numeric canonical 값과 display width를 분리한다. `001`과 `1`은 같은 값이고 출력에서 자릿수를 적용한다.                                                       | 최대값과 허용 display width는 운영 규모·양식 검증 후 별도 확정한다.                             |
| D-09 | 가번호 유일 범위       | 승인      | 현 `ADMISSION`/`SCHEDULE` 정책을 유지하고 수동·자동·사전부여·재부여와 DB claim에 동일하게 적용한다.                                                               | 정책 강화 시 충돌 1건이라도 있으면 전체 rollback한다.                                           |
| D-10 | 범위 겹침·용량         | 승인      | `ADMISSION`은 전형 내 범위 중복을 금지하고 union capacity가 전체 대상 수 이상이어야 한다. `SCHEDULE`은 다른 slot 간 재사용 가능하나 같은 slot 내 중복은 금지한다. | 부족하거나 겹치면 저장·전환을 차단한다. 현재 39/138 상태는 수정 전까지 No-Go다.                 |
| D-11 | 레거시 할당 5건        | 승인      | 추정 연결·삭제·재번호 없이 immutable legacy reservation/history로 보존한다.                                                                                       | 외부 근거로 exact mapping이 승인된 건만 별도 revision에서 이관한다.                             |
| D-12 | 고립 수험생 8건        | 승인      | 추정 일정 생성이나 삭제 없이 legacy identity/history로 보존한다.                                                                                                  | 외부 근거로 candidate 또는 sample 여부가 확인되면 별도 승인 기록으로 처리한다.                  |
| D-13 | 기존 출력 3건          | 원칙 승인 | registration을 추정하지 않고 immutable legacy print snapshot/history로 보존한다.                                                                                  | 구체 보존 기간과 파기 절차는 개인정보 책임자가 별도 확정한다.                                   |
| D-14 | 계정 전형 범위         | 승인      | `ALL`/`ASSIGNED`를 명시한다. 현 무배정 계정은 `ALL`, 배정 계정은 exact admission ID의 `ASSIGNED`로 옮긴다.                                                        | `ASSIGNED`인데 배정 0건인 상태는 저장 차단한다.                                                 |
| D-15 | 사진 identity·보존     | 원칙 승인 | 사진은 registration이 아니라 `candidate` 기준으로 관리한다.                                                                                                       | 접근권한, 보존 기간, 파기 시점은 별도 확정한다.                                                 |
| D-16 | 빈 전형 설정           | 승인      | 빈 `admission_name` 설정은 특정 전형에 추정 연결하지 않고 명시적 global default로 보존한다.                                                                       | 전형별 override가 없을 때만 global default를 적용한다.                                          |
| D-17 | 양식 lifecycle         | 승인      | draft는 수정 가능하고 published version은 immutable이다. 변경은 새 version으로 만들며 과거 version과 출력 snapshot을 보존한다.                                    | 정정도 새 version으로 처리한다.                                                                 |
| D-18 | 인쇄 재시도·보존       | 원칙 승인 | 실패와 재시도 상태를 구분하고 재출력 사유·actor·시각을 append-only audit로 남긴다. snapshot은 덮지 않는다.                                                        | expiry, 최대 재시도, 보존 기간과 파기 절차는 별도 확정한다.                                     |
| D-19 | cutover 관찰 기준      | 원칙 승인 | exact 대상의 old/new mismatch가 0일 때만 cutover한다. 권한 노출·유일 위반·오참조는 1건도 허용하지 않는다.                                                         | 최소 관찰 기간·처리량, latency·오류율·lock 임계치는 별도 확정한다.                              |

## 운영 부속 결정표

| ID   | 결정 주제                | 상태      | 승인된 결정                                                                                                     | 예외·후속 운영값                                                                      |
| ---- | ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| D-20 | 마감 해제 삭제 의미      | 승인      | 마감 해제는 current assignment/absence projection만 해제하고 event, audit, print snapshot은 보존한다.           | 법적 삭제만 별도 승인된 파기 절차로 수행하며 cascade hard delete하지 않는다.          |
| D-21 | 재부여 history           | 승인      | 현재 할당값은 하나의 projection으로 유지하고 부여·해제·재부여는 append-only event로 보존한다.                   | overwrite만 수행하거나 audit 없는 재부여는 금지한다.                                  |
| D-22 | template projection 호환 | 원칙 승인 | 기존 data tag는 compatibility alias로 유지한다. 필수 신규 값이 없으면 빈 값을 내지 않고 명시적 오류로 중단한다. | alias 지원 종료 버전·기간은 실제 사용량 0과 compatibility 증거 확인 후 별도 확정한다. |

## 결정별 필수 증거

- source/target/exact/unmapped/ambiguous 건수와 NFKC·trim 충돌 그룹 수
- 유일 정책별 충돌 그룹, 범위 capacity sum·union capacity·대상 수·deficit
- `ALL/ASSIGNED` 계정 수와 비정상 조합 수
- old/new salted shadow match/mismatch 집계
- MariaDB 통합·부하·lock, API contract, 역할별 권한과 화면 검증 결과

## 최종 승인

| 항목                                     | 값                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| revision                                 | 2                                                                                    |
| D-01~D-22 원칙 결정 완료                 | 예                                                                                   |
| ADR 0002 Accepted                        | 예                                                                                   |
| backup/restore 리허설 성공               | 아니오                                                                               |
| 목표 identity migration `027+` 작성 승인 | 예 — expand·테스트 작성. 운영 DB 적용·backfill·cutover는 각 게이트 통과 후 별도 승인 |
| 승인자·일시                              | 사용자 / 2026-08-28                                                                  |

결론은 **설계·schema expand 작성 Go, 운영 적용 No-Go**다. 개인정보 backup/restore 리허설,
승인된 복원본 dry-run, ADMISSION 범위 39/138 해소, 운영 임계치 확정과 후속 게이트 증거 없이
운영 DB backfill 또는 read/write cutover를 실행하지 않는다.
