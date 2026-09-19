import { createPortal, flushSync } from "react-dom";
import { useId, useState } from "react";
import type { DataTagCatalog } from "../../shared/templates/template-editor-contracts";
import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { groupDataTags } from "./enhance-data-tag-panel";
import { renderProjectDataTagIcon } from "./editor/examlist-template-editor-adapter";
import { isBarcodeSource } from "./barcode-source-model";
import "../../styles/barcode-source-picker.css";

export function BarcodeSourcePicker({
  catalog,
  onSelect,
  onClose,
  showValueOption = false,
  initialShowText = true,
}: {
  catalog: DataTagCatalog;
  onSelect(key: string, showText: boolean): void;
  onClose(): void;
  showValueOption?: boolean;
  initialShowText?: boolean;
}) {
  const dialogRef = useDialogFocus<HTMLElement>();
  useEscapeKey(true, onClose);
  const titleId = useId();
  const [showText, setShowText] = useState(initialShowText);
  const groups = groupDataTags(catalog)
    .map((group) => ({ ...group, tags: group.tags.filter(isBarcodeSource) }))
    .filter((group) => group.tags.length > 0);
  return createPortal(
    <div
      className="admin-modal-backdrop barcode-source-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="admin-modal-card barcode-source-card examlist-template-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <p>데이터 선택</p>
            <h2 id={titleId}>바코드 데이터</h2>
          </div>
          <ModalCloseButton onClick={onClose} />
        </header>
        <p className="barcode-source-help">바코드에 연결할 데이터를 선택하세요.</p>
        {showValueOption && (
          <label className="barcode-source-value-option">
            <input type="checkbox" checked={showText} onChange={(event) => setShowText(event.target.checked)} />
            바코드 값 표시
          </label>
        )}
        <div className="template-tag-accordion barcode-source-options">
          {groups.map((group) => (
            <details className="template-tag-accordion-group" key={group.id}>
              <summary className="template-tag-accordion-summary" tabIndex={0}>
                <span className="template-tag-group-heading">
                  <span
                    className="template-tag-group-icon"
                    dangerouslySetInnerHTML={{ __html: renderProjectDataTagIcon(group.icon) }}
                  />
                  <span className="template-tag-group-label">{group.label}</span>
                  <span className="template-tag-group-count">{group.tags.length}</span>
                </span>
                <span className="template-tag-group-chevron" aria-hidden="true" />
              </summary>
              <div className="template-tag-accordion-list">
                {group.tags.map((tag) => {
                  const key = String(tag.key || tag.dataKey);
                  return (
                    <button
                      key={key}
                      type="button"
                      className="template-tag-button template-tag-accordion-button"
                      onClick={() => {
                        // Remove the modal's focus/inert layer before inserting into the canvas.
                        flushSync(onClose);
                        onSelect(key, showText);
                      }}
                    >
                      <span
                        className="template-tag-button-icon"
                        dangerouslySetInnerHTML={{ __html: renderProjectDataTagIcon(group.icon) }}
                      />
                      <span className="template-tag-button-label">{tag.label || key}</span>
                    </button>
                  );
                })}
              </div>
            </details>
          ))}
          {!groups.length && <p className="editor-empty">사용 가능한 데이터 태그가 없습니다.</p>}
        </div>
      </section>
    </div>,
    document.body,
  );
}
