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
  displayWidth?: number;
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
  labelTemplateId?: number | null;
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
      const displayWidth = saved?.displayWidth ?? setting.displayWidth;
      return withForcedCapacity(schedule, rangeStart, displayWidth);
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

export function updateRangeStart(
  ranges: RangeDraft[],
  index: number,
  rangeStart: number,
  displayWidth?: number,
): RangeDraft[] {
  return ranges.map((range, rangeIndex) =>
    rangeIndex === index ? withForcedCapacity(range, rangeStart, displayWidth) : range,
  );
}

export function applyBulkRangeSettings(
  ranges: RangeDraft[],
  start: number,
  mode: BulkRangeMode,
  criteria: BulkRangeCriterion[] = [],
  displayWidth?: number,
): RangeDraft[] {
  if (mode === "SAME_START") {
    return ranges.map((range) => withForcedCapacity(range, start, displayWidth));
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
    const assigned = withForcedCapacity(range, nextStart, displayWidth);
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
  return ranges.map(
    ({ date, time, period, admission, unit, major, building, room, rangeStart, rangeEnd, displayWidth }) => ({
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
      displayWidth,
    }),
  );
}

export function parseRangeNumberInput(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 9);
  return {
    value: digits ? Number(digits) : 0,
    displayWidth: Math.max(1, digits.length),
  };
}

export function formatRangeNumber(value: number, displayWidth?: number) {
  const text = String(Math.max(0, value));
  return text.padStart(Math.max(displayWidth ?? text.length, text.length), "0");
}

export function createSettingsSnapshot(value: SettingsSnapshotInput) {
  return JSON.stringify({
    assignmentMethod: value.assignmentMethod,
    ranges: value.ranges.map(({ candidateCount: _candidateCount, ...range }) => range),
    autoDrawEnabled: value.autoDrawEnabled,
    autoDrawDelaySeconds: value.autoDrawDelaySeconds,
    printPreassignedLabel: value.printPreassignedLabel,
    labelTemplateId: value.labelTemplateId,
    autoAssignAbsenteesOnClose: value.autoAssignAbsenteesOnClose,
    deleteAbsenteeInfoOnReopen: value.deleteAbsenteeInfoOnReopen,
    useCandidatePhotos: value.useCandidatePhotos,
    enableBulkDraw: value.enableBulkDraw,
  });
}

function withForcedCapacity<T extends { candidateCount: number }>(
  range: T,
  rangeStart: number,
  displayWidth?: number,
): T & {
  rangeStart: number;
  rangeEnd: number;
  displayWidth?: number;
} {
  const rangeEnd = rangeStart + range.candidateCount - 1;
  const requestedWidth = displayWidth ?? ("displayWidth" in range ? Number(range.displayWidth) : undefined);
  const result = {
    ...range,
    rangeStart,
    rangeEnd,
  };
  return requestedWidth ? { ...result, displayWidth: Math.max(requestedWidth, String(rangeEnd).length) } : result;
}
