export interface AttendanceState {
  absent: number | boolean;
  processed: number | boolean;
  closed: number | boolean;
}

export function candidateAttendance(state: AttendanceState): "응시" | "결시" | "대기" {
  if (Number(state.absent)) return "결시";
  if (Number(state.processed)) return "응시";
  return Number(state.closed) ? "결시" : "대기";
}
