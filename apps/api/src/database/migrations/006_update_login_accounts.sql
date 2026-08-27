UPDATE app_user
SET login_id = '가번호', display_name = '가번호 사용자', role = 'OPERATOR', enabled = TRUE
WHERE login_id = 'operator';
