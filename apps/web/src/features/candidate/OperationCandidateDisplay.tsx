import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { OperationCandidatePreview } from "./OperationCandidatePreview";
import { OperationDrawPopover } from "./OperationDrawPopover";

type Props = ComponentProps<typeof OperationCandidatePreview> & {
  drawOpen: boolean;
  drawProps: ComponentProps<typeof OperationDrawPopover>;
};

export function OperationCandidateDisplay({ drawOpen, drawProps, ...preview }: Props) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const view = viewport?.ownerDocument.defaultView;
    if (!viewport || !view) return;
    const resize = () => {
      const style = view.getComputedStyle(viewport);
      const width = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (width > 0 && height > 0) setScale(Math.min(width / 1200, height / 800));
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(viewport);
    view.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      view.removeEventListener("resize", resize);
    };
  }, []);
  return (
    <main ref={viewportRef} className="operator-console operator-candidate-display" aria-label="수험생 안내 화면">
      <div className="operator-candidate-display-fit" style={{ width: 1200 * scale, height: 800 * scale }}>
        <div className="operator-candidate-display-content" style={{ transform: `scale(${scale})` }}>
          <OperationCandidatePreview {...preview} />
          <div className="operator-candidate-display-draw-slot">
            {drawOpen && preview.candidate && preview.selectedMode !== "PREASSIGNED" && (
              <OperationDrawPopover {...drawProps} position={{ left: 0, top: 0 }} readOnly />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
