import { useEffect, useState } from "react";
import { fetchSystemProfile, type DeveloperSettings } from "../../shared/api/developer-settings";

export const DEFAULT_SYSTEM_PROFILE: DeveloperSettings = {
  schoolName: "",
  academicYear: new Date().getFullYear(),
  systemName: "가번호 관리 시스템",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
  logoFileName: null,
  logoDataUrl: null,
  updatedAt: "",
};

export function useSystemProfile() {
  const [systemProfile, setSystemProfile] = useState<DeveloperSettings>(DEFAULT_SYSTEM_PROFILE);

  useEffect(() => {
    let active = true;
    void fetchSystemProfile()
      .then((profile) => {
        if (active) setSystemProfile(profile);
      })
      .catch(() => {
        /* 기본 브랜드를 유지합니다. */
      });
    return () => {
      active = false;
    };
  }, []);

  return { systemProfile, setSystemProfile };
}
