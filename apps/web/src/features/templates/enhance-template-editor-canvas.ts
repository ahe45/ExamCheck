import {
  getTemplateEditorCanvasZoomPercentLabel,
  handleTemplateEditorCanvasZoomWheel,
  resetTemplateEditorCanvasZoom,
  stepTemplateEditorCanvasZoom,
} from "examlist-template-editor/core";

export function enhanceTemplateEditorCanvas(root: HTMLElement) {
  const canvas = root.querySelector<HTMLElement>("[data-template-editor-canvas]");
  const scaleBox = canvas?.querySelector<HTMLElement>("[data-template-editor-canvas-scale-box]");
  const surface = canvas?.querySelector<HTMLElement>("[data-template-editor-runtime-surface]");
  if (!canvas || !scaleBox || !surface) return () => undefined;

  const zoomState = {
    canvasZoom: Number(canvas.dataset.templateEditorCanvasZoom || 1),
    canvasZoomMode: canvas.dataset.templateEditorCanvasZoomMode || "manual",
  };

  canvas.classList.add("editor-canvas-column");
  canvas.setAttribute("role", "region");
  canvas.setAttribute("aria-label", "본문 캔버스");
  surface.classList.add("editor-paper", "editor-document-surface");
  surface.classList.toggle("editable", surface.contentEditable !== "false");
  surface.classList.toggle("readonly", surface.contentEditable === "false");
  surface.setAttribute("data-editor-document-surface", "true");
  surface.setAttribute("data-placeholder", "용지 위에 제목, 본문, 표, 이미지, 데이터 태그를 자유롭게 배치하세요.");
  surface.setAttribute("spellcheck", "false");

  const controls = document.createElement("div");
  controls.className = "template-editor-canvas-zoom-controls";
  controls.setAttribute("aria-label", "캔버스 확대/축소");
  controls.innerHTML = `
    <div class="template-editor-canvas-zoom-toolbar" role="toolbar" aria-label="캔버스 확대/축소">
      <button class="template-editor-canvas-zoom-button" data-template-editor-canvas-zoom-direction="-1" type="button" aria-label="캔버스 축소">−</button>
      <button class="template-editor-canvas-zoom-value" data-action="reset-template-editor-canvas-zoom" type="button" aria-label="캔버스 확대율 초기화">
        <span data-template-editor-canvas-zoom-label>${getTemplateEditorCanvasZoomPercentLabel(zoomState.canvasZoom)}</span>
      </button>
      <button class="template-editor-canvas-zoom-button" data-template-editor-canvas-zoom-direction="1" type="button" aria-label="캔버스 확대">+</button>
    </div>
  `;
  canvas.insertBefore(controls, scaleBox);

  const handleClick = (event: Event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "[data-template-editor-canvas-zoom-direction], [data-action='reset-template-editor-canvas-zoom']",
    );
    if (!button || !controls.contains(button)) return;
    const direction = Number(button.dataset.templateEditorCanvasZoomDirection || 0);
    if (direction) {
      stepTemplateEditorCanvasZoom(zoomState, direction, { rootElement: canvas });
    } else {
      resetTemplateEditorCanvasZoom(zoomState, { rootElement: canvas });
    }
  };
  const handleWheel = (event: WheelEvent) => {
    if (handleTemplateEditorCanvasZoomWheel(event, zoomState, { rootElement: canvas })) return;
    if (event.ctrlKey || event.metaKey) return;

    const lineHeight = 16;
    const pageHeight = canvas.clientHeight || window.innerHeight || 800;
    const modeScale =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? lineHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? pageHeight
          : 1;
    const normalizedX = event.deltaX * modeScale;
    const normalizedY = event.deltaY * modeScale;
    const deltaX = event.shiftKey && Math.abs(normalizedX) < Math.abs(normalizedY) ? normalizedY : normalizedX;
    const deltaY = event.shiftKey && canvas.scrollWidth > canvas.clientWidth + 1 ? 0 : normalizedY;
    const maxScrollLeft = Math.max(0, canvas.scrollWidth - canvas.clientWidth);
    const maxScrollTop = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, canvas.scrollLeft + deltaX));
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, canvas.scrollTop + deltaY));

    if (nextScrollLeft === canvas.scrollLeft && nextScrollTop === canvas.scrollTop) return;
    event.preventDefault();
    canvas.scrollLeft = nextScrollLeft;
    canvas.scrollTop = nextScrollTop;
  };

  controls.addEventListener("click", handleClick);
  canvas.addEventListener("wheel", handleWheel, { passive: false });

  return () => {
    controls.removeEventListener("click", handleClick);
    canvas.removeEventListener("wheel", handleWheel);
    controls.remove();
  };
}
