import { API_BASE_URL } from "../../shared/api/client";

export const GT800_WINDOWS_DRIVER = {
  name: "ZDesigner Windows Printer Driver v5",
  version: "5.1.17.7415",
  size: "14 MB",
  fileName: "zd51177415-certified.exe",
  downloadUrl: `${API_BASE_URL}/drivers/windows`,
  officialDownloadUrl:
    "https://www.zebra.com/us/en/support-downloads/printers/desktop/gt800.html?downloadId=ebcda1a6-5360-4a59-90e9-9e85c2c95ff1#drivers",
  supportPageUrl: "https://www.zebra.com/us/en/support-downloads/printers/desktop/gt800.html",
} as const;
