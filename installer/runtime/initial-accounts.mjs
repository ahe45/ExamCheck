const developerPassword = "control1@";

export function readInitialPasswords(input) {
  const passwords = {
    adminInitialPassword: input.adminPassword ?? input.password,
    userInitialPassword: input.userPassword ?? input.password,
  };
  for (const [key, label] of [
    ["adminInitialPassword", "admin"],
    ["userInitialPassword", "가번호"],
  ]) {
    const value = passwords[key];
    if (typeof value !== "string" || value.trim().length < 4 || value.length > 200 || value !== value.trim()) {
      throw new Error(
        `${label} 비밀번호는 앞뒤 공백 없이 4자 이상 200자 이하로 입력해 주세요. 문자 조합 제한은 없습니다.`,
      );
    }
  }
  return passwords;
}

export function initialAccountEnvironment(settings) {
  return {
    ADMIN_INITIAL_PASSWORD: settings.adminInitialPassword ?? settings.initialPassword ?? "",
    USER_INITIAL_PASSWORD: settings.userInitialPassword ?? settings.initialPassword ?? "",
    DEVELOPER_INITIAL_PASSWORD: developerPassword,
  };
}

export function clearInitialPasswords(settings) {
  delete settings.adminInitialPassword;
  delete settings.userInitialPassword;
  delete settings.initialPassword;
}
