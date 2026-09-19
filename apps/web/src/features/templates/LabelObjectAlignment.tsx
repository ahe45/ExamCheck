import { useId, useRef, useState } from "react";
import type { LabelAlignment } from "./label-element-alignment";

const options: { command: LabelAlignment; label: string; path: string; rect: [number, number, number, number] }[] = [
  { command: "left", label: "왼쪽 맞춤", path: "M5 4v16", rect: [9, 7, 10, 10] },
  { command: "center-x", label: "가로 가운데", path: "M12 4v16", rect: [7, 7, 10, 10] },
  { command: "right", label: "오른쪽 맞춤", path: "M19 4v16", rect: [5, 7, 10, 10] },
  { command: "top", label: "위쪽 맞춤", path: "M4 5h16", rect: [7, 9, 10, 10] },
  { command: "center-y", label: "세로 가운데", path: "M4 12h16", rect: [7, 7, 10, 10] },
  { command: "bottom", label: "아래쪽 맞춤", path: "M4 19h16", rect: [7, 5, 10, 10] },
  { command: "distribute-x", label: "가로 간격 동일", path: "M4 5v14M20 5v14M7 8v8M17 8v8", rect: [10, 7, 4, 10] },
  { command: "distribute-y", label: "세로 간격 동일", path: "M5 4h14M5 20h14M8 7h8M8 17h8", rect: [7, 10, 10, 4] },
];

export function LabelObjectAlignment({ count, onAlign }: { count: number; onAlign(command: LabelAlignment): void }) {
  return (
    <section className="label-object-alignment" aria-label="개체 정렬">
      <div className="template-toolbar-section examlist-object-align-control">
        <span className="template-toolbar-section-label">정렬</span>
        <div className="examlist-object-align-grid">
          <AlignmentMenu label="맞춤" options={options.slice(0, 6)} disabled={count === 0} onAlign={onAlign} />
          <AlignmentMenu label="간격" options={options.slice(6)} disabled={count < 3} onAlign={onAlign} />
        </div>
      </div>
    </section>
  );
}

function AlignmentMenu({
  label,
  options: items,
  disabled,
  onAlign,
}: {
  label: string;
  options: typeof options;
  disabled: boolean;
  onAlign(command: LabelAlignment): void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="examlist-object-align-section">
      <span className="examlist-object-align-section-label">{label}</span>
      <span
        className={`template-toolbar-select-wrap template-toolbar-icon-select examlist-object-align-select${open && !disabled ? " open" : ""}${openUp ? " open-up" : ""}`}
        data-examlist-object-align-select={items[0]!.command.startsWith("distribute-") ? "distribute" : "align"}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            trigger.current?.focus();
          }
        }}
      >
        <button
          ref={trigger}
          type="button"
          className="template-toolbar-icon-select-button"
          aria-label={`${label} 정렬 메뉴 열기`}
          aria-expanded={open && !disabled}
          aria-controls={id}
          disabled={disabled}
          onClick={(event) => {
            const button = event.currentTarget.getBoundingClientRect();
            const panel = event.currentTarget.closest("aside")?.getBoundingClientRect();
            const bottom = Math.min(panel?.bottom ?? window.innerHeight, window.innerHeight);
            setOpenUp(bottom - button.bottom < items.length * 37 + 18);
            setOpen(!open);
          }}
        >
          <span className="template-toolbar-icon-select-current-icon">
            <AlignmentIcon option={items[0]!} />
          </span>
          <span className="template-toolbar-icon-select-label">{label}</span>
          <span className="template-toolbar-icon-select-caret" aria-hidden="true" />
        </button>
        {open && !disabled && (
          <div id={id} className="template-toolbar-icon-select-menu" role="group" aria-label={`${label} 정렬`}>
            {items.map((option) => (
              <button
                key={option.command}
                type="button"
                className="template-toolbar-icon-select-option"
                onClick={() => {
                  onAlign(option.command);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <span className="template-toolbar-icon-select-option-icon">
                  <AlignmentIcon option={option} />
                </span>
                <span className="template-toolbar-icon-select-option-label">{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

function AlignmentIcon({ option: { path, rect } }: { option: (typeof options)[number] }) {
  return (
    <svg className="template-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={path} />
      <rect x={rect[0]} y={rect[1]} width={rect[2]} height={rect[3]} rx="1.5" />
    </svg>
  );
}
