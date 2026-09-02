export const formTemplateDataTags = {
  groups: [
    {
      key: "system",
      label: "시스템 정보",
      tags: [
        { key: "system.title", label: "시스템명", type: "string", example: "가번호 관리 시스템" },
        { key: "school.name", label: "학교명", type: "string", example: "한국대학교" },
        { key: "candidate.admissionYear", label: "학년도", type: "string", example: "2026" },
        { key: "system.printedAt", label: "출력일시", type: "string", example: "2026-09-12 09:30" },
      ],
    },
    {
      key: "exam",
      label: "시험 정보",
      tags: [
        { key: "candidate.examName", label: "시험명", type: "string", example: "2026년도 면접고사" },
        { key: "candidate.examDate", label: "시험날짜", type: "date", example: "2026-10-30" },
        { key: "candidate.examStartTime", label: "시험시간", type: "time", example: "10:00" },
        { key: "candidate.examEndTime", label: "종료시간", type: "time", example: "12:00" },
        { key: "candidate.periodName", label: "교시명", type: "string", example: "오전" },
        {
          key: "candidate.admissionTypeName",
          label: "전형명",
          type: "string",
          example: "학생부교과 면접",
        },
        { key: "candidate.departmentName", label: "모집단위명", type: "string", example: "유아교육과" },
        { key: "candidate.majorName", label: "전공명", type: "string", example: "유아교육" },
      ],
    },
    {
      key: "candidate",
      label: "수험생 정보",
      tags: [
        { key: "candidate.examNo", label: "수험번호", type: "string", example: "1162001" },
        { key: "candidate.name", label: "이름", type: "string", example: "이○민" },
        { key: "candidate.birthDate", label: "생년월일", type: "date", example: "2008-07-24" },
        { key: "candidate.temporaryNo", label: "가번호", type: "string", example: "01" },
        { key: "candidate.preassignedNo", label: "사전 배정 가번호", type: "string", example: "01" },
        { key: "candidate.groupName", label: "조", type: "string", example: "1조" },
        { key: "candidate.absent", label: "결시 여부", type: "string", example: "응시" },
        { key: "candidate.photo", label: "수험생 사진", type: "image", example: "사진" },
      ],
    },
    {
      key: "site",
      label: "고사장 정보",
      tags: [
        { key: "candidate.buildingName", label: "고사건물명", type: "string", example: "사범관" },
        { key: "candidate.roomName", label: "고사실명", type: "string", example: "면접고사실" },
        { key: "candidate.seatNo", label: "지정정렬", type: "string", example: "1" },
      ],
    },
    {
      key: "option",
      label: "추가 정보",
      tags: [
        ...Array.from({ length: 3 }, (_, index) => ({
          key: `candidate.opt${index + 1}`,
          label: `OPT${index + 1}`,
          type: "string",
          example: `추가정보 ${index + 1}`,
        })),
      ],
    },
    {
      key: "room",
      label: "고사실 집계",
      tags: [
        { key: "room.assignedCount", label: "배정인원", type: "number", example: "24" },
        { key: "room.presentCount", label: "응시인원", type: "number", example: "22" },
        { key: "room.absentCount", label: "결시인원", type: "number", example: "2" },
      ],
    },
    {
      key: "signature",
      label: "서명",
      tags: [
        { key: "signature.author", label: "작성자", type: "string", example: "김작성" },
        { key: "signature.reviewer", label: "확인자", type: "string", example: "이확인" },
      ],
    },
    {
      key: "etc",
      label: "기타",
      tags: [{ key: "row.indexInPage", label: "순번", type: "number", example: "1" }],
    },
  ],
} as const;
