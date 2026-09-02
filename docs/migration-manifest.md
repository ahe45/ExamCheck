# 데이터베이스 마이그레이션 체크섬 기준선

> 수집일: 2026-09-01
> 상태: 실행기 강제 기준선. `001`~`039` fresh·재실행 및 `026`→`039` 로컬 MariaDB 검증 완료.
> 운영 환경 적용과 backup/restore는 별도 승인·확인 필요.

이미 적용된 마이그레이션 파일을 조용히 수정하면 환경마다 스키마가 달라질 수 있다. 아래 값은 각 마이그레이션을 기준선에 등록한 시점의 파일 크기와 SHA-256이며, 실행기에서 체크섬을 검증하기 위한 기준 자료다.

| 버전                                                  | 크기(bytes) | SHA-256                                                            |
| ----------------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| `001_initial_schema.sql`                              |       4,849 | `5BA9DB768082812DF315EC41781592A83596EC0CD5BF87354770AD1314F08D62` |
| `002_auth_and_examinee.sql`                           |       1,700 | `7C7760F86887477A82FF6CA5D25181F5991D02D193DFEE6AF3453A09AC03A2E9` |
| `003_pseudonym_management.sql`                        |       2,623 | `0FD395AE13772247A39F23E6646FE1531CBDBD6453ED1D90EC576748EC5851CA` |
| `004_add_assignment_samples.sql`                      |         247 | `DB489EA88F43CFD67935538308B6877E19E6F284955D0C8A042B29263F409023` |
| `005_add_unassigned_samples.sql`                      |         562 | `A546F64C91BDBB30ABC9322B9609EFE375E24DA133C50DA746F84FDEEF3CD072` |
| `006_update_login_accounts.sql`                       |         145 | `CA84D4035F3004AD5202EE0CB76B78A933EB11548F625A62B1CF9E50E3066182` |
| `007_form_templates.sql`                              |       5,378 | `F10B3B31998683FBA912FC213B25756756207ABF786D24F5E493B1282DB3D4CE` |
| `008_candidate_records.sql`                           |       1,824 | `2CE98133DCD265C5F5168E9501EAEB8695EACEF7F663C3E8FF04F3A62040CDB6` |
| `009_candidate_upload_template_and_photos.sql`        |       1,335 | `2E4F9172638F7924D4C4568456B145D3B7378C8F3422474ACA11853424099E15` |
| `010_pseudonym_operation_settings.sql`                |       1,859 | `952DC15D2ECFB9191F4DF2B93020802F497002B73706C215E0D6F54A5C002BFE` |
| `011_expand_pseudonym_range_schedule.sql`             |         994 | `F90120966C6E16CB4E2CE991D62840A0023A62A9C1955716A94EC2C7293C6E20` |
| `012_sequential_assignment_and_preassigned_print.sql` |         235 | `6F55CC4ED1292A20AD60D3759C016AC317F256B336755C39C3A6258CED6BA905` |
| `013_account_admission_assignments.sql`               |         790 | `A309D22AB86DCC661C0A32D65ACCB4647780F18180BE7CF6C235FB1C6B00DB73` |
| `014_developer_role_and_system_profile.sql`           |         871 | `757FB84F48D55224C6B4D643597B90374985656FE7AF8E460AFC273FFC16B862` |
| `015_admission_scoped_pseudonym_settings.sql`         |         773 | `5DBC0EE3C13ABFC5F6A9D2AA2B6956416AEC0C574EC6B761B88BF4A26896F1FB` |
| `016_auto_draw_settings.sql`                          |         211 | `1514006773F16746949E115ACC2FDD922C7E504BBA2BEFC122249BE4D6B238A1` |
| `017_operation_closure.sql`                           |       1,245 | `4F2B131757837DE2C8D31EC7BEB5AD335CABADE145C5BD714819AFBA6ED38D52` |
| `018_drop_account_display_name.sql`                   |          47 | `AE7E20D48AF8B32CB8E869DBBB25D31115A0BBD0E443E5AA56CC76B745F50F95` |
| `019_number_uniqueness_policies.sql`                  |       1,699 | `6FFFCB7D4CBB71B79D2FA862C09DEDABC468604698E9DF4B5B79E9E22B8BA1CA` |
| `020_assignment_schedule_uniqueness.sql`              |         337 | `6A99D1EC3885ADA55E40531A69C25AC056334F79515A7D1E8739837EBDF4178B` |
| `021_reconcile_legacy_assignment_candidates.sql`      |       1,622 | `1380A319D84E00C84F54DBC43AD8FECD46FB8D08B0AF31C0D403F0EDD78B97D2` |
| `022_pseudonym_setting_optimistic_version.sql`        |         175 | `C70C881EEAA66A1A4FB0B666DDC31AB2FF7E307C3F152CBB5FBA04B5B39F9447` |
| `023_print_job_idempotency.sql`                       |         206 | `1CBDB139532AC3BDB2A2391411E32B9C4FC89323A5584BD289C0FF39CF96675F` |
| `024_app_user_session_version.sql`                    |         100 | `86E205CFD06405AD80B7335D027B1864C6115F4A5BBD3796C87A42626E718281` |
| `025_print_job_request_fingerprint.sql`               |         130 | `3177FB5CC7CFDBA6240D39F34F39FA8C26BF35C9861CDE5BD1BC3E7D85188CD9` |
| `026_expand_audit_request_id.sql`                     |          68 | `E11048D1AE752A7CE711A93CCAF77DEDA8E6FA12D01BDEFA5B0B48DFEA93689D` |
| `027_target_identity_core.sql`                        |       8,398 | `0566B1E69BEA58E7AD82476C118BA1CE283172F8E0965D92A9638B39A49C2849` |
| `028_target_identity_policies.sql`                    |       6,632 | `307F76600F78059AEEA2597D3201691AEACE91D64F1A8806DF3C43AB4842482B` |
| `029_target_identity_operations.sql`                  |       7,600 | `2AC909AF49C26DCCF9F341A9306EB9278ABD3FF1EA9CAC3BA6B36226FB5D02BF` |
| `030_target_identity_account_scope.sql`               |         668 | `55539D5A0A22124BF33D57BCE86404F4C27BF76B13BA4EBCDC5F4E146F4ED14B` |
| `031_target_identity_candidate_photo.sql`             |         877 | `9F74DF652AFED46A99BB4B27E4E3538196F210594A6E72A68866896A26DDA030` |
| `032_target_identity_print_template.sql`              |       2,703 | `62B2C3E6860BD7D9F3702FE6C7FFDBDC5B9F69AD41672CBA3B6658184697CF98` |
| `033_target_identity_transition_control.sql`          |       4,513 | `16B52B437CA5F3D68414286B0C6CE4FCC5DDA9A35B4F07A9B9990857182C9DE5` |
| `034_target_identity_transition_gate.sql`             |       7,357 | `CC3D657481ADBD759484B77399AEB01361CD367C3E56337FC4228D9FF2D580A2` |
| `035_print_job_reissue_history.sql`                   |       1,726 | `F172608CDCF2B5B29726AA74C5FC480C168929254521D39AFB416F0131B28341` |
| `036_identity_shadow_verification_batch.sql`          |       2,279 | `ABBDFD7C509DF82EFD1C04F848ABD6BF705AA2978C10D3231C9A72A9573F9DAD` |
| `037_immutable_identity_history.sql`                  |       2,902 | `DDA8ABC7B74587D222EC501C0C2BDA8BE144AA80A3C82D04B21B0D3B557D9133` |
| `038_form_template_deletion.sql`                      |         425 | `33F3485976F9A6F8C17B5800D5B30DB331A77E2B8A0EC66E80168208A5A36D95` |
| `039_remove_form_template_versioning.sql`             |         883 | `4E4C4D4EDB05D4AEEF00F913F2C87F773C28DE22E6F6C936ED10F83F057EDEEA` |

현재 소스 기준 migration은 `001`–`039`이다. 019는 번호 유일 정책과 assignment 일정 연결
필드를 확장하고, 020은 일정 연결·scope key 기반 고유키로 전환하며, 021은 019 이전 할당 중
정확히 한 일정에만 대응하는 행만 보정한다. 022는 전형 설정의 동시 저장 충돌을 감지하는 버전
필드를 추가한다. 로컬 데이터 11건 중 6건이 정확히 매핑되었고, 자동 결정할 수 없는 레거시
5건은 변경하지 않았다. 023은 사용자별 인쇄 작업 멱등 키를, 024는 계정 세션 강제 무효화
버전을, 025는 동일 멱등 키의 다른 요청 재사용을 차단하는 요청 지문을 추가한다. 026은 HTTP
request ID의 최대 길이와 맞도록 `audit_log.request_id`를 `VARCHAR(128)`로 확장하며 목표 identity
모델의 테이블·키·데이터 의미는 변경하지 않는다. `027`–`032`는 목표 identity의 ID 기반 관계·정책·이력과
호환 projection을 expand-only로 추가하고, 033은 기본 `LEGACY/LEGACY` 전환 상태·backfill checkpoint·
issue·shadow observation·canary allowlist를 추가한다. 034는 증적, 분리 승인, 요청, append-only 상태
이력 구조를 추가하며 기존 업무 read/write를 자동으로 전환하지 않는다. 035는 실패·만료 작업의
재시도와 전송 완료 작업의 재출력을 새 작업으로 만들고, 고정 사유 코드·작업자·시각을 변경·삭제
불가 이력으로 보존하는 구조를 추가한다. 036은 shadow 검증 한 회차의 9개 domain observation을
하나의 완료 batch로 묶고 allowlisted 업무 mutation을 직렬화하는 singleton source watermark를
추가한다. 037은 과거 출력 snapshot과 identity 이력의 변경을 DB trigger로 차단한다. 038은
양식 삭제 상태를 별도 기록하고, 039는 양식 코드별 최신 데이터 한 건을 보존한 뒤 발행·보관
상태와 과거 이력 컬럼·trigger를 제거해 단일 양식을 직접 수정하는 구조로 전환한다.

`001`–`039`는 fresh 임시 DB에서 적용·재실행·체크섬을 검증했다. 통합 harness는 `026` 상태의
기존 인쇄·양식 데이터를 보존한 채 `027`–`039`를 적용하고 전체 migration을 다시 실행한다.
목표 identity 테이블·제약과 기본 legacy 상태, 034 증적/승인/이력 제약, 036 batch 경계,
identity 불변 trigger 및 039 단일 양식 전환을 실제 MariaDB에서 확인했다.
이는 로컬 synthetic 검증이며 운영 snapshot upgrade 또는 운영 전환 완료를 뜻하지 않는다.
각 staging·운영 환경의 적용 여부는 해당 환경의 `schema_migration`으로 확인해야 하며, 이
기록은 backup/restore 리허설이나 운영 배포 완료를 의미하지 않는다.

## 운영 규칙

- 적용된 파일은 수정하지 않고 새 번호의 마이그레이션을 추가한다.
- 실행기 강제 전, 운영 DB의 `schema_migration`과 실제 파일 목록을 대조한다.
- 현재 확인된 MariaDB 11.4의 DDL은 트랜잭션 rollback을 전제로 하지 않는다. 실패 복구 절차와 재실행 가능성을 각 파일별로 검토한다.
- 체크섬 불일치가 발견되면 자동 덮어쓰기하지 않고 배포를 중단한 뒤 원인을 조사한다.
- 실행기는 `schema_migration.checksum`을 검증하고 원본 SQL 파일 누락도 차단한다.
- 실행기는 내부 `schema_migration.status`를 additive 확장해 각 적용을 `APPLYING`→`APPLIED` 또는
  `FAILED`로 기록한다. `APPLYING`/`FAILED`가 남으면 다른 파일과 체크섬 backfill을 시작하기 전에
  차단한다. 이 실행기 내부 메타데이터 확장은 `026_expand_audit_request_id.sql`과 별개다.
- 체크섬 도입 전 이미 적용된 행은 최초 실행 시 현재 SQL 파일 값을 기록하므로, 최초 실행 전에 이 문서와 기준 commit/tag를 별도로 대조해야 한다.
- 실행기는 서버 단위 고정 이름 `examcheck_schema_migration_v1`의 DB advisory lock을 획득한 뒤 마이그레이션을 수행하고, 성공·실패 경로 모두에서 잠금 해제를 시도한다. 기본 대기 시간은 30초다.
- fresh·N-1·staging·운영 단계의 실행, 증거, 중단·복구 절차는
  [migration runbook](./runbooks/migration.md)을 따른다.
