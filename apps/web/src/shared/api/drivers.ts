import { apiBlob, saveBlob } from "./client";

export async function downloadDriver(token: string, driverId: "windows" | "browser-print") {
  const { blob, headers } = await apiBlob(`/drivers/${driverId}`, { timeoutMs: 5 * 60_000 }, token);
  const fallback = driverId === "windows" ? "zd51177415-certified.exe" : "zebra-browser-print-windows-v132489.exe";
  const contentDisposition = headers.get("Content-Disposition") ?? "";
  const fileName = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
  saveBlob(blob, fileName);
}
