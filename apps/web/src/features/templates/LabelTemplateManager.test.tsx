// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrinterService } from "../printer/PrinterService";
import { defaultLabelLayout } from "./label-template-model";

const apiMock = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  deleteLabelTemplate: vi.fn(),
  fetchLabelTemplates: vi.fn(),
  fetchLabelTemplate: vi.fn(),
  previewLabelTemplate: vi.fn(),
  saveLabelTemplate: vi.fn(),
  updateLabelTemplateActive: vi.fn(),
}));

vi.mock("../../shared/api/label-templates", async (importOriginal) => ({
  ...(await importOriginal()),
  ...apiMock,
}));

import { LabelTemplateManager } from "./LabelTemplateManager";
import { LABEL_EDITOR_SESSION_KEY } from "../../shared/session/template-session";

const template = {
  id: 1,
  code: "PSEUDONYM_LABEL",
  name: "기본 가번호 라벨",
  description: "기본 출력 양식",
  zplTemplate: "^XA^XZ",
  layout: defaultLabelLayout,
  defaultCopies: 1,
  active: true,
  createdAt: "2026-09-03T00:00:00.000Z",
  createdByLoginId: "admin",
};

describe("LabelTemplateManager", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    apiMock.templates = [template];
    apiMock.fetchLabelTemplate.mockImplementation(async (_token, code) =>
      apiMock.templates.find((template) => template.code === code),
    );
    apiMock.fetchLabelTemplates.mockReset();
    apiMock.saveLabelTemplate.mockReset();
    apiMock.previewLabelTemplate.mockReset();
    apiMock.fetchLabelTemplates.mockImplementation(async () => ({
      templates: apiMock.templates.map(({ layout, zplTemplate: _payload, ...metadata }) => ({
        ...metadata,
        thumbnail: layout,
      })),
      dataTags: {
        groups: [
          {
            key: "candidate",
            label: "수험생 정보",
            tags: [
              { key: "candidate.temporaryNo", label: "가번호", example: "1501" },
              { key: "candidate.examNo", label: "수험번호", example: "20260001" },
            ],
          },
        ],
      },
    }));
    apiMock.saveLabelTemplate.mockImplementation(async (_token, input) => {
      const saved = { ...template, ...input };
      apiMock.templates = [saved];
      return saved;
    });
    apiMock.previewLabelTemplate.mockResolvedValue({
      layout: defaultLabelLayout,
      zplTemplate: "^XA^FD1501^FS^XZ",
      samplePayload: "^XA^FD1501^FS^XZ",
    });
  });

  async function openEditor() {
    expect(await screen.findByRole("heading", { name: "라벨 양식 관리" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(await screen.findByRole("heading", { name: "라벨 양식 편집" })).toBeVisible();
  }

  it("새로고침하면 라벨 편집 화면을 유지하고 저장된 내용만 다시 불러온다", async () => {
    const first = render(<LabelTemplateManager token="token" />);
    await openEditor();
    fireEvent.change(screen.getByLabelText("양식 제목"), { target: { value: "복원할 편집 양식" } });
    fireEvent.change(screen.getByLabelText("기본 인쇄 매수"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("X(mm)"), { target: { value: "10" } });
    fireEvent(window, new Event("pagehide"));
    expect(JSON.parse(window.sessionStorage.getItem(LABEL_EDITOR_SESSION_KEY)!)).toEqual({ sourceCode: template.code });
    first.unmount();
    apiMock.templates = [{ ...template, name: "서버의 최신 양식" }];
    render(<LabelTemplateManager token="token" />);
    expect(await screen.findByLabelText("양식 제목")).toHaveValue("서버의 최신 양식");
    expect(screen.getByLabelText("기본 인쇄 매수")).toHaveValue(1);
    expect(screen.getByLabelText("X(mm)")).toHaveValue(defaultLabelLayout.elements[0]!.xMm);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("이전에 저장된 임시 내용도 무시하고 새 양식 화면은 기본 상태로 연다", async () => {
    window.sessionStorage.setItem(
      LABEL_EDITOR_SESSION_KEY,
      JSON.stringify({
        sourceCode: null,
        draft: {
          code: "OLD_DRAFT",
          name: "임시 이름",
          description: "임시 설명",
          defaultCopies: 3,
          layout: { ...defaultLabelLayout, widthMm: 80 },
        },
      }),
    );
    render(<LabelTemplateManager token="token" />);
    expect(await screen.findByLabelText("양식 제목")).toHaveValue("");
    expect(screen.getByLabelText("양식 설명")).toHaveValue("");
    expect(screen.getByLabelText("기본 인쇄 매수")).toHaveValue(1);
    expect(JSON.parse(window.sessionStorage.getItem(LABEL_EDITOR_SESSION_KEY)!)).toEqual({ sourceCode: null });
  });

  it("바코드 삽입 시 데이터를 선택하며 닫으면 개체와 저장 상태를 변경하지 않는다", async () => {
    render(<LabelTemplateManager token="token" />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "바코드" }));
    const dialog = screen.getByRole("dialog", { name: "바코드 데이터" });
    expect(dialog).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "바코드 데이터" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^개체 \d:/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "바코드" }));
    const picker = screen.getByRole("dialog", { name: "바코드 데이터" });
    expect(within(picker).getByRole("checkbox", { name: "바코드 값 표시" })).toBeChecked();
    fireEvent.click(within(picker).getByRole("checkbox", { name: "바코드 값 표시" }));
    fireEvent.click(within(picker).getByText("수험생 정보"));
    fireEvent.click(within(picker).getByRole("button", { name: "수험번호" }));
    expect(screen.queryByRole("dialog", { name: "바코드 데이터" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^개체 \d:/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(1));
    expect(apiMock.saveLabelTemplate.mock.calls[0]?.[1].layout.elements.at(-1)).toMatchObject({
      kind: "barcode",
      content: "{{candidate.examNo}}",
      showText: false,
    });
    const barcode = screen.getAllByRole("button", { name: /^개체 \d:/ }).at(-1)!;
    fireEvent.doubleClick(barcode);
    const editPicker = screen.getByRole("dialog", { name: "바코드 데이터" });
    expect(within(editPicker).getByRole("checkbox", { name: "바코드 값 표시" })).not.toBeChecked();
    fireEvent.click(within(editPicker).getByRole("checkbox", { name: "바코드 값 표시" }));
    fireEvent.click(within(editPicker).getByText("수험생 정보"));
    fireEvent.click(within(editPicker).getByRole("button", { name: "수험번호" }));
    expect(screen.getAllByRole("button", { name: /^개체 \d:/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(2));
    expect(apiMock.saveLabelTemplate.mock.calls[1]?.[1].layout.elements.at(-1).showText).toBe(true);
    expect(screen.queryByRole("checkbox", { name: "바코드 값 표시" })).not.toBeInTheDocument();
    expect(screen.queryByText("위치는 회전 후 왼쪽 위, 크기는 회전 전 기준입니다.")).not.toBeInTheDocument();
  });

  it("삭제된 라벨이나 잘못된 복원 정보가 있으면 라벨 목록을 표시한다", async () => {
    window.sessionStorage.setItem(LABEL_EDITOR_SESSION_KEY, JSON.stringify({ sourceCode: "DELETED" }));
    const first = render(<LabelTemplateManager token="token" />);
    expect(await screen.findByRole("heading", { name: "라벨 양식 관리" })).toBeVisible();
    expect(window.sessionStorage.getItem(LABEL_EDITOR_SESSION_KEY)).toBeNull();
    first.unmount();
    window.sessionStorage.setItem(LABEL_EDITOR_SESSION_KEY, '{"draft":null}');
    render(<LabelTemplateManager token="token" />);
    expect(await screen.findByRole("heading", { name: "라벨 양식 관리" })).toBeVisible();
  });

  it("용지 맞춤과 다중 선택 정렬을 저장하고 선택만 변경하면 수정 상태가 되지 않는다", async () => {
    const onDirtyChange = vi.fn();
    render(<LabelTemplateManager token="token" onDirtyChange={onDirtyChange} />);
    await openEditor();
    const objects = screen.getAllByRole("button", { name: /^개체 \d:/ });
    fireEvent.keyDown(objects[1]!, { key: "Enter", shiftKey: true });
    expect(screen.getAllByRole("button", { name: /^개체 \d:/, pressed: true })).toHaveLength(2);
    expect(screen.queryByRole("combobox", { name: "개체 정렬 기준" })).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "간격 정렬 메뉴 열기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "맞춤 정렬 메뉴 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "왼쪽 맞춤" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("기본 가번호 라벨 라벨 양식을 저장했습니다.");
    expect(
      apiMock.saveLabelTemplate.mock.calls[0]?.[1].layout.elements.map((item: { xMm: number }) => item.xMm),
    ).toEqual([0, 4, 4]);
    fireEvent.keyDown(objects[0]!, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "맞춤 정렬 메뉴 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "오른쪽 맞춤" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(2));
    expect(
      apiMock.saveLabelTemplate.mock.calls[1]?.[1].layout.elements.map((item: { xMm: number }) => item.xMm),
    ).toEqual([8, 4, 4]);
  });

  it("전체 선택·해제와 다중 삭제가 선택한 개체에만 적용된다", async () => {
    render(<LabelTemplateManager token="token" />);
    await openEditor();
    expect(screen.queryByRole("button", { name: "전체 선택" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "선택 해제" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("라벨 용지"), { key: "a", ctrlKey: true });
    expect(screen.getAllByRole("button", { name: /^개체 \d:/, pressed: true })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "간격 정렬 메뉴 열기" })).toBeEnabled();
    fireEvent.keyDown(screen.getByLabelText("라벨 용지"), { key: "Escape" });
    expect(screen.getByRole("button", { name: "맞춤 정렬 메뉴 열기" })).toBeDisabled();
    const objects = screen.getAllByRole("button", { name: /^개체 \d:/ });
    fireEvent.keyDown(objects[0]!, { key: "Enter" });
    fireEvent.keyDown(objects[1]!, { key: "Enter", ctrlKey: true });
    expect(screen.queryByRole("button", { name: "선택 요소 삭제" })).not.toBeInTheDocument();
    fireEvent.keyDown(objects[1]!, { key: "Delete" });
    expect(screen.getAllByRole("button", { name: /^개체 \d:/ })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /^개체 \d:/, pressed: true })).toHaveLength(0);
  });

  it("mm 글자 크기와 정렬을 그대로 저장하며 입력란의 Delete는 개체를 삭제하지 않는다", async () => {
    render(<LabelTemplateManager token="token" />);
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "글꼴 크기 목록 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "5mm" }));
    fireEvent.click(screen.getByRole("button", { name: "오른쪽 정렬" }));
    expect(screen.getByRole("button", { name: "오른쪽 정렬" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("내용")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("양식 제목"), { key: "Delete" });
    expect(screen.getAllByRole("button", { name: /^개체 \d:/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(1));
    expect(apiMock.saveLabelTemplate.mock.calls[0]?.[1].layout.elements[0].fontSizeMm).toBe(5);
    expect(apiMock.saveLabelTemplate.mock.calls[0]?.[1].layout.elements[0].align).toBe("right");
    const object = screen.getAllByRole("button", { name: /^개체 \d:/ })[0]!;
    fireEvent.keyDown(object, { key: "Delete" });
    expect(screen.getAllByRole("button", { name: /^개체 \d:/ })).toHaveLength(2);
    expect(screen.getByLabelText("라벨 용지")).toHaveFocus();
  });

  it("라벨 탭 진입 시 문서 양식과 같은 썸네일 카드 목록을 표시한다", async () => {
    render(<LabelTemplateManager token="token" />);

    expect(await screen.findByRole("heading", { name: "라벨 양식 관리" })).toBeVisible();
    expect(screen.getByText("기본 가번호 라벨")).toBeVisible();
    expect(screen.getByText("기본 출력 양식")).toBeVisible();
    expect(screen.getByText("총 1건")).toBeVisible();
    expect(screen.getByRole("button", { name: "수정" })).toBeVisible();
  });

  it("방향키로 개체와 그룹을 이동하고 용지 경계와 입력란에서는 개체 위치를 유지한다", async () => {
    render(<LabelTemplateManager token="token" />);
    await openEditor();
    const canvas = screen.getByLabelText("라벨 용지");
    const object = screen.getAllByRole("button", { name: /^개체 \d:/ })[0]!;
    fireEvent.keyDown(object, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(object, { key: "ArrowDown" });
    expect(screen.getByLabelText("X(mm)")).toHaveValue(4.1);
    expect(screen.getByLabelText("Y(mm)")).toHaveValue(5);
    fireEvent.keyDown(screen.getByLabelText("양식 제목"), { key: "ArrowLeft" });
    expect(screen.getByLabelText("X(mm)")).toHaveValue(4.1);
    fireEvent.keyDown(object, { key: "ArrowLeft", ctrlKey: true });
    fireEvent.keyDown(object, { key: "ArrowUp" });
    fireEvent.keyDown(object, { key: "ArrowDown", ctrlKey: true });
    expect(screen.getByLabelText("Y(mm)")).toHaveValue(4.1);
    fireEvent.keyDown(object, { key: "ArrowUp", ctrlKey: true });
    expect(screen.getByLabelText("Y(mm)")).toHaveValue(4);
    fireEvent.keyDown(canvas, { key: "a", ctrlKey: true });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowLeft", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(1));
    expect(
      apiMock.saveLabelTemplate.mock.calls[0]?.[1].layout.elements.map((item: { xMm: number }) => item.xMm),
    ).toEqual(defaultLabelLayout.elements.map((item) => item.xMm + 0.9));
    fireEvent.keyDown(object, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("X(mm)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Y(mm)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeDisabled());
    fireEvent.keyDown(object, { key: "ArrowLeft" });
    fireEvent.keyDown(object, { key: "ArrowUp", ctrlKey: true });
    expect(screen.getByLabelText("X(mm)")).toHaveValue(0);
    expect(screen.getByLabelText("Y(mm)")).toHaveValue(0);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("편집 내용을 버전 없이 현재 양식에 저장한다", async () => {
    const onDirtyChange = vi.fn();
    render(<LabelTemplateManager token="token" onDirtyChange={onDirtyChange} />);
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "수험번호 · 20260001" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(1));
    expect(apiMock.saveLabelTemplate.mock.calls[0]?.[1]).toMatchObject({
      code: "PSEUDONYM_LABEL",
      name: "기본 가번호 라벨",
      active: true,
    });
    expect(apiMock.saveLabelTemplate.mock.calls[0]?.[1]).not.toHaveProperty("version");
    expect(await screen.findByText("기본 가번호 라벨 라벨 양식을 저장했습니다.")).toBeVisible();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("양식의 기본 인쇄 매수를 편집하고 다시 열면 저장한 매수를 표시한다", async () => {
    apiMock.templates = [{ ...template, defaultCopies: 2 }];
    render(<LabelTemplateManager token="token" />);
    await openEditor();
    const copies = screen.getByRole("spinbutton", { name: "기본 인쇄 매수" });
    expect(copies).toHaveValue(2);
    fireEvent.change(copies, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(apiMock.saveLabelTemplate).toHaveBeenCalledWith("token", expect.objectContaining({ defaultCopies: 4 })),
    );
    await screen.findByText("기본 가번호 라벨 라벨 양식을 저장했습니다.");
    fireEvent.click(screen.getByRole("button", { name: "양식 목록" }));
    await openEditor();
    expect(screen.getByRole("spinbutton", { name: "기본 인쇄 매수" })).toHaveValue(4);
  });

  it("다중 선택한 개체는 각자의 각도에서 90도씩 회전하고 선택하지 않은 개체는 유지한다", async () => {
    apiMock.templates = [
      {
        ...template,
        layout: {
          ...defaultLabelLayout,
          elements: defaultLabelLayout.elements.map((element, index) => ({
            ...element,
            widthMm: 10,
            heightMm: 4,
            rotation: [0, 90, 270][index],
          })),
        },
      },
    ];
    const { container } = render(<LabelTemplateManager token="token" />);
    await openEditor();
    const objects = screen.getAllByRole("button", { name: /^개체 \d:/ });
    const clockwise = screen.getByRole("button", { name: "시계 방향 90도 회전" });
    const counterclockwise = screen.getByRole("button", { name: "반시계 방향 90도 회전" });
    fireEvent.keyDown(objects[1]!, { key: "Enter", ctrlKey: true });
    expect(clockwise).toBeEnabled();
    fireEvent.click(clockwise);
    const elements = () => Array.from(container.querySelectorAll<HTMLElement>(".label-canvas-element"));
    expect(elements().map((element) => element.style.transform)).toEqual([
      "rotate(90deg) translateY(-100%)",
      "rotate(180deg) translate(-100%, -100%)",
      "rotate(270deg) translateX(-100%)",
    ]);
    fireEvent.click(counterclockwise);
    fireEvent.keyDown(screen.getByLabelText("라벨 용지"), { key: "a", ctrlKey: true });
    fireEvent.click(clockwise);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(apiMock.saveLabelTemplate).toHaveBeenCalledTimes(1));
    expect(
      apiMock.saveLabelTemplate.mock.calls[0]?.[1].layout.elements.map(
        (element: { rotation: number }) => element.rotation,
      ),
    ).toEqual([90, 180, 0]);
    for (let turn = 0; turn < 4; turn++) fireEvent.click(counterclockwise);
    expect(elements().map((element) => element.style.transform)).toEqual([
      "rotate(90deg) translateY(-100%)",
      "rotate(180deg) translate(-100%, -100%)",
      "",
    ]);
    fireEvent.keyDown(screen.getByLabelText("라벨 용지"), { key: "Escape" });
    expect(clockwise).toBeDisabled();
    expect(counterclockwise).toBeDisabled();
  });

  it.each([90, 270])("개체의 %s° 회전을 저장·썸네일·재편집에 유지한다", async (rotation) => {
    const { container } = render(<LabelTemplateManager token="token" />);
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: rotation === 90 ? "시계 방향 90도 회전" : "반시계 방향 90도 회전" }),
    );
    expect((container.querySelector(".label-canvas-element.selected") as HTMLElement).style.transform).toContain(
      `rotate(${rotation}deg)`,
    );
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("기본 가번호 라벨 라벨 양식을 저장했습니다.");
    expect(apiMock.saveLabelTemplate.mock.calls[0]?.[1].layout.elements[0].rotation).toBe(rotation);
    fireEvent.click(screen.getByRole("button", { name: "양식 목록" }));
    expect((container.querySelector(".label-template-thumbnail-element") as HTMLElement).style.transform).toContain(
      `rotate(${rotation}deg)`,
    );
    await openEditor();
    expect((container.querySelector(".label-canvas-element.selected") as HTMLElement).style.transform).toContain(
      `rotate(${rotation}deg)`,
    );
  });

  it.each(["", "0", "11", "1.5"])("유효하지 않은 기본 인쇄 매수 %s는 저장하지 않는다", async (value) => {
    render(<LabelTemplateManager token="token" />);
    await openEditor();
    fireEvent.change(screen.getByRole("spinbutton", { name: "기본 인쇄 매수" }), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("기본 인쇄 매수는 1~10 사이의 정수로 입력해 주세요.")).toBeVisible();
    expect(apiMock.saveLabelTemplate).not.toHaveBeenCalled();
  });

  it("편집기에서 문서 양식과 같은 데이터 태그 검색 UI를 제공한다", async () => {
    render(<LabelTemplateManager token="token" />);
    await openEditor();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "수험번호" } });
    expect(screen.getByRole("button", { name: "수험번호 · 20260001" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "가번호 · 1501" })).not.toBeInTheDocument();
  });

  it("저장된 진단 상태가 없어도 프린터를 다시 찾아 테스트 출력한다", async () => {
    const printer = { id: "printer-1", name: "Zebra GT800", connection: "USB" as const };
    const service = {
      discover: vi.fn().mockResolvedValue({
        printers: [printer],
        diagnostic: { status: "READY", printer, message: "사용 가능" },
      }),
      sendRaw: vi.fn().mockResolvedValue(undefined),
    } as unknown as PrinterService;
    render(<LabelTemplateManager token="token" service={service} />);
    await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "테스트 출력" }));
    await waitFor(() => expect(service.sendRaw).toHaveBeenCalledWith(printer, "^XA^FD1501^FS^XZ"));
  });
});
