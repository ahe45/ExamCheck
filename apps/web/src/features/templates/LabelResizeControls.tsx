import { useRef, type RefObject } from "react";
import type { LabelTemplateElement, LabelTemplateLayout } from "../../shared/api/label-templates";
import { labelElementBounds } from "./label-element-alignment";
import { labelResizeHandles, resizeLabelElement, type LabelResizeHandle } from "./label-element-resize";

interface Props {
  element: LabelTemplateElement;
  selectedElements?: readonly LabelTemplateElement[];
  layout: LabelTemplateLayout;
  canvasRef: RefObject<HTMLDivElement | null>;
  onResize(elements: LabelTemplateElement[]): void;
}
interface ResizeDrag {
  moved: boolean;
  pointerId: number;
  handle: LabelResizeHandle;
  startX: number;
  startY: number;
  canvasWidth: number;
  canvasHeight: number;
  elements: readonly LabelTemplateElement[];
  layout: LabelTemplateLayout;
}

export function LabelResizeControls({ element, selectedElements, layout, canvasRef, onResize }: Props) {
  const dragRef = useRef<ResizeDrag | null>(null);
  const bounds = labelElementBounds(element);
  return (
    <div
      className="label-resize-controls"
      style={{
        // The 2px outline with a 2px offset has its center 3px outside the element.
        left: `calc(${(bounds.x / layout.widthMm) * 100}% - 3px)`,
        top: `calc(${(bounds.y / layout.heightMm) * 100}% - 3px)`,
        width: `calc(${(bounds.width / layout.widthMm) * 100}% + 6px)`,
        height: `calc(${(bounds.height / layout.heightMm) * 100}% + 6px)`,
      }}
    >
      {labelResizeHandles.map((handle) => (
        <button
          type="button"
          key={handle.key}
          className={`label-resize-handle handle-${handle.key}`}
          aria-label={`${handle.label} 크기 조절`}
          style={{ left: `${(handle.x + 1) * 50}%`, top: `${(handle.y + 1) * 50}%` }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const canvas = canvasRef.current?.getBoundingClientRect();
            if (!canvas?.width || !canvas.height) return;
            canvasRef.current?.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              moved: false,
              pointerId: event.pointerId,
              handle: handle.key,
              startX: event.clientX,
              startY: event.clientY,
              canvasWidth: canvas.width,
              canvasHeight: canvas.height,
              elements: selectedElements ?? [element],
              layout,
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId))
              return;
            if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return;
            drag.moved = true;
            event.stopPropagation();
            onResize(
              drag.elements.map((item) =>
                resizeLabelElement(
                  item,
                  drag.handle,
                  ((event.clientX - drag.startX) / drag.canvasWidth) * drag.layout.widthMm,
                  ((event.clientY - drag.startY) / drag.canvasHeight) * drag.layout.heightMm,
                  drag.layout,
                  event.shiftKey,
                ),
              ),
            );
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            dragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onLostPointerCapture={() => {
            dragRef.current = null;
          }}
        />
      ))}
    </div>
  );
}
