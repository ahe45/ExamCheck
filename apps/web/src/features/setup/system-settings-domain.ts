import type { CandidateRecord } from "../../shared/api/candidates";
import type {
  PseudonymAssignmentMethod,
  PseudonymSetting,
  UpdatePseudonymSettingInput,
} from "../../shared/api/pseudonyms";

export interface RangeDraft {
  date: string;
  time: string;
  period: string;
  admission: string;
  unit: string;
  major: string;
  building: string;
  room: string;
  rangeStart: number;
  rangeEnd: number;
  candidateCount: number;
}

export type BulkRangeMode = "SAME_START" | "CONTINUOUS";
export type BulkRangeCriterion = "date" | "period" | "admission" | "unit" | "major" | "building" | "room";

export interface SettingsSnapshotInput {
  assignmentMethod: PseudonymAssignmentMethod;
  ranges: RangeDraft[];
  autoDrawEnabled: boolean;
  autoDrawDelaySeconds: number;
  printPreassignedLabel: boolean;
  autoAssignAbsenteesOnClose: boolean;
  deleteAbsenteeInfoOnReopen: boolean;
  useCandidatePhotos: boolean;
  enableBulkDraw: boolean;
}

export function buildScheduleRanges(candidates: CandidateRecord[], setting: PseudonymSetting): RangeDraft[] {
  const schedules = new Map<string, Omit<RangeDraft, "rangeStart" | "rangeEnd">>();
  for (const candidate of candidates) {
    const date = candidate.date.trim();
    const time = candidate.time.trim();
    if (!date || !time) continue;
    const schedule = {
      date,
      time,
      period: candidate.period.trim(),
      admission: candidate.admission.trim(),
      unit: candidate.unit.trim(),
      major: candidate.major.trim(),
      building: candidate.building.trim(),
      room: candidate.room.trim(),
      candidateCount: 1,
    };
    const key = scheduleIdentity(schedule);
    const current = schedules.get(key);
    if (current) current.candidateCount += 1;
    else schedules.set(key, schedule);
  }

  return [...schedules.values()]
    .sort((left, right) => scheduleIdentity(left).localeCompare(scheduleIdentity(right)))
    .map((schedule) => {
      const saved = setting.ranges.find((range) => scheduleIdentity(range) === scheduleIdentity(schedule));
      const rangeStart = saved?.rangeStart ?? setting.rangeStart;
      return withForcedCapacity(schedule, rangeStart);
    });
}

export function scheduleIdentity(
  value: Pick<RangeDraft, "date" | "time" | "period" | "admission" | "unit" | "major" | "building" | "room">,
) {
  return [
    value.date,
    value.time,
    value.period,
    value.admission,
    value.unit,
    value.major,
    value.building,
    value.room,
  ].join("|");
}

export function updateRangeStart(ranges: RangeDraft[], index: number, rangeStart: number): RangeDraft[] {
  return ranges.map((range, rangeIndex) => (rangeIndex === index ? withForcedCapacity(range, rangeStart) : range));
}

export function applyBulkRangeSettings(
  ranges: RangeDraft[],
  start: number,
  mode: BulkRangeMode,
  criteria: BulkRangeCriterion[] = [],
): RangeDraft[] {
  if (mode === "SAME_START") {
    return ranges.map((range) => withForcedCapacity(range, start));
  }

  let nextStart = start;
  const assignedRanges = new Map<number, RangeDraft>();
  const orderedRanges = ranges
    .map((range, index) => ({ range, index }))
    .sort((left, right) => {
      for (const criterion of criteria) {
        const compared = left.range[criterion].localeCompare(right.range[criterion], "ko-KR", { numeric: true });
        if (compared) return compared;
      }
      return scheduleIdentity(left.range).localeCompare(scheduleIdentity(right.range), "ko-KR", { numeric: true });
    });

  for (const { range, index } of orderedRanges) {
    const assigned = withForcedCapacity(range, nextStart);
    nextStart = assigned.rangeEnd + 1;
    assignedRanges.set(index, assigned);
  }
  return ranges.map((range, index) => assignedRanges.get(index) ?? range);
}

export function totalRangeCapacity(ranges: RangeDraft[]) {
  return ranges.reduce((sum, range) => sum + Math.max(0, range.rangeEnd - range.rangeStart + 1), 0);
}

export function hasInvalidRange(ranges: RangeDraft[]) {
  return ranges.some((range) => range.rangeStart < 1 || range.rangeEnd - range.rangeStart + 1 !== range.candidateCount);
}

export function configuredRangeBounds(ranges: RangeDraft[], fallbackRange: { start: number; end: number }) {
  return ranges.length
    ? {
        rangeStart: Math.min(...ranges.map((range) => range.rangeStart)),
        rangeEnd: Math.max(...ranges.map((range) => range.rangeEnd)),
      }
    : { rangeStart: fallbackRange.start, rangeEnd: fallbackRange.end };
}

export function toSettingRanges(ranges: RangeDraft[]): UpdatePseudonymSettingInput["ranges"] {
  return ranges.map(({ date, time, period, admission, unit, major, building, room, rangeStart, rangeEnd }) => ({
    date,
    time,
    period,
    admission,
    unit,
    major,
    building,
    room,
    rangeStart,
    rangeEnd,
  }));
}

export function createSettingsSnapshot(value: SettingsSnapshotInput) {
  return JSON.stringify({
    assignmentMethod: value.assignmentMethod,
    ranges: value.ranges.map(({ candidateCount: _candidateCount, ...range }) => range),
    autoDrawEnabled: value.autoDrawEnabled,
    autoDrawDelaySeconds: value.autoDrawDelaySeconds,
    printPreassignedLabel: value.printPreassignedLabel,
    autoAssignAbsenteesOnClose: value.autoAssignAbsenteesOnClose,
    deleteAbsenteeInfoOnReopen: value.deleteAbsenteeInfoOnReopen,
    useCandidatePhotos: value.useCandidatePhotos,
    enableBulkDraw: value.enableBulkDraw,
  });
}

function withForcedCapacity<T extends { candidateCount: number }>(
  range: T,
  rangeStart: number,
): T & {
  rangeStart: number;
  rangeEnd: number;
} {
  return {
    ...range,
    rangeStart,
    rangeEnd: rangeStart + range.candidateCount - 1,
  };
}
