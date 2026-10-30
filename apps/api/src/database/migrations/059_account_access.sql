ALTER TABLE app_user
  ADD COLUMN last_access_at DATETIME(3) NULL COMMENT '마지막 접속 확인 시간';
