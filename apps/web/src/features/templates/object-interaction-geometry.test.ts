import { describe, expect, it } from "vitest";
import {
  calculateObjectMovePosition,
  calculateObjectResizeRect,
  getObjectResizeDirections,
  objectResizeHandles,
} from "examlist-template-editor/examlist/template-editor/object-interaction-geometry";

describe("template editor shared object interaction geometry", () => {
  it.each([
    ["top-left", -1, -1],
    ["top", 0, -1],
    ["top-right", 1, -1],
    ["right", 1, 0],
    ["bottom-right", 1, 1],
    ["bottom", 0, 1],
    ["bottom-left", -1, 1],
    ["left", -1, 0],
  ] as const)("%s 핸들의 축 방향과 반대편 고정점을 유지한다", (handle, x, y) => {
    expect(objectResizeHandles).toContain(handle);
    expect(getObjectResizeDirections(handle)).toEqual({ x, y });

    const rect = calculateObjectResizeRect({
      deltaX: 20,
      deltaY: 10,
      directionX: x,
      directionY: y,
      maximumHeight: 400,
      maximumWidth: 500,
      minimumHeight: 24,
      minimumWidth: 24,
      startHeight: 100,
      startLeft: 50,
      startTop: 40,
      startWidth: 200,
    });

    if (x < 0) expect(rect.left + rect.width).toBe(250);
    if (x > 0) expect(rect.left).toBe(50);
    if (x === 0) expect(rect.width).toBe(200);
    if (y < 0) expect(rect.top + rect.height).toBe(140);
    if (y > 0) expect(rect.top).toBe(40);
    if (y === 0) expect(rect.height).toBe(100);
  });

  it("캔버스를 꽉 채운 개체는 서브픽셀 이동량에도 경계를 벗어나지 않는다", () => {
    expect(
      calculateObjectMovePosition({
        deltaX: 0.8,
        deltaY: -0.8,
        maximumLeft: 0.4,
        maximumTop: 0.4,
        startLeft: 0,
        startTop: 0,
      }),
    ).toEqual({ left: 0, top: 0 });
  });

  it("Shift 모서리 조절은 원래 가로세로 비율과 캔버스 경계를 함께 지킨다", () => {
    expect(
      calculateObjectResizeRect({
        deltaX: 120,
        deltaY: 10,
        directionX: 1,
        directionY: 1,
        maximumHeight: 150,
        maximumWidth: 400,
        minimumHeight: 24,
        minimumWidth: 24,
        preserveAspectRatio: true,
        startHeight: 100,
        startLeft: 0,
        startTop: 0,
        startWidth: 200,
      }),
    ).toEqual({ height: 150, left: 0, top: 0, width: 300 });
  });
});
