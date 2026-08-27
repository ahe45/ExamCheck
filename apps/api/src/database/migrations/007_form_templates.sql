CREATE TABLE IF NOT EXISTS form_template (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(100) NOT NULL,
  version INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  description VARCHAR(500) NULL,
  category VARCHAR(100) NOT NULL,
  usage_scope ENUM('CANDIDATE', 'ROOM', 'EXAM') NOT NULL DEFAULT 'CANDIDATE',
  layout_json JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_form_template_code_version (code, version),
  KEY ix_form_template_scope_active (usage_scope, active),
  CONSTRAINT fk_form_template_created_by FOREIGN KEY (created_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO form_template
  (code, version, name, description, category, usage_scope, layout_json, active, created_by)
SELECT
  'PSEUDONYM_SLIP', 1, '가번호표', '가번호 부여 후 수험생에게 제공하는 기본 양식', '가번호', 'CANDIDATE',
  JSON_OBJECT(
    'id', 'template-pseudonym-slip',
    'name', '가번호표',
    'layout', JSON_OBJECT(
      'dataTagSettings', JSON_OBJECT(
        'sampleData', JSON_OBJECT(
          'candidate.examNo', '20260001',
          'candidate.name', '홍길동',
          'candidate.temporaryNo', '1501',
          'candidate.examDate', '2026-09-12',
          'candidate.roomName', 'A-101'
        )
      ),
      'pages', JSON_ARRAY(
        JSON_OBJECT(
          'id', 'page-1',
          'type', 'content',
          'settings', JSON_OBJECT(
            'documentHtml', '<div style="text-align:center;padding:32px 20px;"><p style="font-size:15px;letter-spacing:.16em;">가번호 관리 시스템</p><h1 style="font-size:32px;margin:24px 0 8px;">가번호표</h1><p style="font-size:76px;font-weight:700;margin:18px 0;"><span class="template-token" data-template-tag-value="candidate.temporaryNo">1501</span></p><table style="width:100%;border-collapse:collapse;margin-top:28px;"><tbody><tr><th style="border:1px solid #333;padding:10px;">수험번호</th><td style="border:1px solid #333;padding:10px;"><span class="template-token" data-template-tag-value="candidate.examNo">20260001</span></td></tr><tr><th style="border:1px solid #333;padding:10px;">성명</th><td style="border:1px solid #333;padding:10px;"><span class="template-token" data-template-tag-value="candidate.name">홍길동</span></td></tr><tr><th style="border:1px solid #333;padding:10px;">시험실</th><td style="border:1px solid #333;padding:10px;"><span class="template-token" data-template-tag-value="candidate.roomName">A-101</span></td></tr></tbody></table></div>'
          )
        )
      )
    )
  ),
  TRUE, id
FROM app_user WHERE login_id = 'system';

INSERT IGNORE INTO form_template
  (code, version, name, description, category, usage_scope, layout_json, active, created_by)
SELECT
  'CANDIDATE_CONFIRMATION', 1, '수험생 확인표', '수험생과 시험 정보를 확인하는 기본 양식', '수험생', 'CANDIDATE',
  JSON_OBJECT(
    'id', 'template-candidate-confirmation',
    'name', '수험생 확인표',
    'layout', JSON_OBJECT(
      'dataTagSettings', JSON_OBJECT(
        'sampleData', JSON_OBJECT(
          'candidate.examNo', '20260001',
          'candidate.name', '홍길동',
          'candidate.examDate', '2026-09-12',
          'candidate.roomName', 'A-101',
          'candidate.seatNo', '01',
          'candidate.temporaryNo', '1501'
        )
      ),
      'pages', JSON_ARRAY(
        JSON_OBJECT(
          'id', 'page-1',
          'type', 'content',
          'settings', JSON_OBJECT(
            'documentHtml', '<div style="padding:28px;"><h1 style="text-align:center;font-size:30px;margin-bottom:30px;">수험생 확인표</h1><table style="width:100%;border-collapse:collapse;font-size:16px;"><tbody><tr><th style="width:30%;border:1px solid #222;padding:12px;background:#f2f4f5;">수험번호</th><td style="border:1px solid #222;padding:12px;"><span class="template-token" data-template-tag-value="candidate.examNo">20260001</span></td></tr><tr><th style="border:1px solid #222;padding:12px;background:#f2f4f5;">성명</th><td style="border:1px solid #222;padding:12px;"><span class="template-token" data-template-tag-value="candidate.name">홍길동</span></td></tr><tr><th style="border:1px solid #222;padding:12px;background:#f2f4f5;">시험일자</th><td style="border:1px solid #222;padding:12px;"><span class="template-token" data-template-tag-value="candidate.examDate" data-template-tag-format-type="date" data-template-tag-format="YYYY.MM.DD">2026.09.12</span></td></tr><tr><th style="border:1px solid #222;padding:12px;background:#f2f4f5;">시험실 / 좌석</th><td style="border:1px solid #222;padding:12px;"><span class="template-token" data-template-tag-value="candidate.roomName">A-101</span> / <span class="template-token" data-template-tag-value="candidate.seatNo">01</span></td></tr><tr><th style="border:1px solid #222;padding:12px;background:#f2f4f5;">가번호</th><td style="border:1px solid #222;padding:12px;font-size:28px;font-weight:700;"><span class="template-token" data-template-tag-value="candidate.temporaryNo">1501</span></td></tr></tbody></table></div>'
          )
        )
      )
    )
  ),
  TRUE, id
FROM app_user WHERE login_id = 'system';
