export const GT800_WINDOWS_DRIVER = {
  name: "ZDesigner Windows Printer Driver v5",
  version: "5.1.17.7415",
  size: "14 MB",
  fileName: "zd51177415-certified.exe",
  downloadUrl: `${import.meta.env.VITE_API_BASE_URL || "http://localhost:3100/api/v1"}/drivers/windows`,
  officialDownloadUrl:
    "https://www.zebra.com/us/en/support-downloads/printers/desktop/gt800.html?downloadId=ebcda1a6-5360-4a59-90e9-9e85c2c95ff1#drivers",
  supportPageUrl: "https://www.zebra.com/us/en/support-downloads/printers/desktop/gt800.html",
} as const;
