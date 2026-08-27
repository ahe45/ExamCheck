# 데이터베이스 마이그레이션 체크섬 기준선

> 수집일: 2026-08-28  
> 상태: 실행기 강제 기준선. `001`~`026` 로컬 적용·재실행 검증 완료. 운영 환경은 별도 확인 필요.

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

현재 소스 기준 migration은 `001`~`026`이다. 019는 번호 유일 정책과 assignment 일정 연결
필드를 확장하고, 020은 일정 연결·scope key 기반 고유키로 전환하며, 021은 019 이전 할당 중
정확히 한 일정에만 대응하는 행만 보정한다. 022는 전형 설정의 동시 저장 충돌을 감지하는 버전
필드를 추가한다. 로컬 데이터 11건 중 6건이 정확히 매핑되었고, 자동 결정할 수 없는 레거시
5건은 변경하지 않았다. 023은 사용자별 인쇄 작업 멱등 키를, 024는 계정 세션 강제 무효화
버전을, 025는 동일 멱등 키의 다른 요청 재사용을 차단하는 요청 지문을 추가한다. 026은 HTTP
request ID의 최대 길이와 맞도록 `audit_log.request_id`를 `VARCHAR(128)`로 확장하며 목표 identity
모델의 테이블·키·데이터 의미는 변경하지 않는다.

`001`~`026`은 2026-08-28 로컬 개발 DB와 fresh 임시 DB에서 적용·재실행·체크섬 검증했다.
통합 harness는 `migrateThrough` 경계로 N-1(`025`)까지만 구성한 뒤 기존 인쇄 작업을 보존하면서
latest(`026`)를 적용하고 전체 migration을 다시 실행한다. 이 시나리오는 `audit_log.request_id`가
128자로 확장됐는지도 확인한다. 이는 현재 `025`→`026` 경로의 회귀 검증이며 향후 027+ 목표 identity
migration이나 운영 snapshot upgrade 완료를 뜻하지 않는다.
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
