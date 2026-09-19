import { useId, useRef, useState } from "react";
import type { LabelTemplateElement } from "../../shared/api/label-templates";

const FONT_SIZES = [1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20];
const alignments = [
  { value: "left", label: "왼쪽 정렬", path: "M4 5h16M4 10h10M4 15h16M4 20h10" },
  { value: "center", label: "가운데 정렬", path: "M4 5h16M7 10h10M4 15h16M7 20h10" },
  { value: "right", label: "오른쪽 정렬", path: "M4 5h16M10 10h10M4 15h16M10 20h10" },
] as const;

export function LabelTextFormatting({
  element,
  onChange,
}: {
  element: LabelTemplateElement | null;
  onChange(patch: Partial<LabelTemplateElement>): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const enabled = element?.kind === "text";
  const sizeMm = Math.round((element?.fontSizeMm ?? 3) * 100) / 100;
  function chooseSize(value: number) {
    onChange({ fontSizeMm: value });
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <section className="template-toolbar-group label-text-formatting" aria-label="글자 서식">
      <span className="template-toolbar-group-label">서식</span>
      <div className="template-toolbar-section">
        <span className="template-toolbar-section-label">크기</span>
        <div className="template-toolbar-group-controls">
          <div
            className={`template-toolbar-font-size-combo${open && enabled ? " open" : ""}`}
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
              className="template-toolbar-combo-value template-toolbar-font-size-value"
              aria-label="글꼴 크기 목록 열기"
              aria-expanded={open && enabled}
              aria-controls={menuId}
              disabled={!enabled}
              onClick={() => setOpen(!open)}
            >
              <span>{enabled ? sizeMm : "-"}</span>
              <span className="template-toolbar-combo-unit" aria-hidden="true">
                mm
              </span>
              <span className="template-toolbar-combo-caret" aria-hidden="true" />
            </button>
            {open && enabled && (
              <div className="template-toolbar-combo-menu" id={menuId} role="group" aria-label="글꼴 크기 목록">
                {FONT_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`template-toolbar-combo-option${sizeMm === size ? " active" : ""}`}
                    aria-pressed={sizeMm === size}
                    onClick={() => chooseSize(size)}
                  >
                    {size}mm
                  </button>
                ))}
                <label className="label-font-custom">
                  직접 입력
                  <input
                    type="number"
                    aria-label="글자 크기(mm)"
                    min={1.5}
                    max={20}
                    step="any"
                    defaultValue={sizeMm}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && event.currentTarget.validity.valid && event.currentTarget.value) {
                        event.preventDefault();
                        chooseSize(event.currentTarget.valueAsNumber);
                      }
                    }}
                    onBlur={(event) => {
                      if (
                        event.currentTarget.validity.valid &&
                        event.currentTarget.value &&
                        event.currentTarget.valueAsNumber !== sizeMm
                      ) {
                        onChange({ fontSizeMm: event.currentTarget.valueAsNumber });
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="template-toolbar-section">
        <span className="template-toolbar-section-label">정렬</span>
        <div className="template-toolbar-group-controls" role="group" aria-label="글자 정렬">
          {alignments.map(({ value, label, path }) => (
            <button
              key={value}
              type="button"
              className="template-tool-button icon-only"
              aria-label={label}
              title={label}
              aria-pressed={enabled && (element.align || "left") === value}
              disabled={!enabled}
              onClick={() => onChange({ align: value })}
            >
              <svg className="template-tool-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d={path} />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LabelObjectNumberField({
  label,
  name,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  name: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  return (
    <label className="examlist-object-size-field">
      <span>{label}</span>
      <span className={`examlist-object-size-input-wrap${value === undefined ? " is-empty is-disabled" : ""}`}>
        <input
          className="template-toolbar-number examlist-object-size-input"
          aria-label={name}
          type="number"
          min={min}
          max={max}
          step={0.1}
          value={value ?? ""}
          placeholder="-"
          disabled={value === undefined}
          onChange={(event) => {
            if (Number.isFinite(event.currentTarget.valueAsNumber)) onChange(event.currentTarget.valueAsNumber);
          }}
        />
        <small aria-hidden="true">mm</small>
      </span>
    </label>
  );
}
