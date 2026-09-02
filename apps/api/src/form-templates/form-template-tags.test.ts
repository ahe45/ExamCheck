import { describe, expect, it } from "vitest";
import { formTemplateDataTags } from "./form-template-tags.js";

describe("formTemplateDataTags", () => {
  const tags = formTemplateDataTags.groups.flatMap((group) => group.tags);
  const keys = tags.map((tag) => tag.key);

  it("실제 업로드 및 운영 화면에서 제공하는 데이터만 노출한다", () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        "candidate.examNo",
        "candidate.temporaryNo",
        "candidate.examDate",
        "candidate.admissionTypeName",
        "candidate.departmentName",
        "candidate.buildingName",
        "candidate.roomName",
        "candidate.seatNo",
        "candidate.opt3",
        "room.absentCount",
        "signature.author",
        "signature.reviewer",
      ]),
    );
    expect(keys).not.toEqual(
      expect.arrayContaining([
        "school.code",
        "candidate.applicationTypeName",
        "candidate.testTypeName",
        "candidate.campusName",
        "candidate.collegeName",
        "candidate.seriesName",
      ]),
    );
  });

  it("업로드 화면과 같은 사용자 용어를 사용한다", () => {
    expect(tags.find((tag) => tag.key === "candidate.examDate")?.label).toBe("시험날짜");
    expect(tags.find((tag) => tag.key === "candidate.buildingName")?.label).toBe("고사건물명");
    expect(tags.find((tag) => tag.key === "candidate.seatNo")?.label).toBe("지정정렬");
    expect(tags.find((tag) => tag.key === "signature.author")?.label).toBe("작성자");
    expect(tags.find((tag) => tag.key === "signature.reviewer")?.label).toBe("확인자");
  });
});
