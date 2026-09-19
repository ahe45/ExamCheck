import { buildGeneratedObjectMarkup } from "examlist-template-editor/core";
import type { DataTagCatalog, TemplateEditorInstance } from "../../shared/templates/template-editor-contracts";
import type { TemplateEditorCommandDispatcher } from "./editor/template-editor-command-dispatcher";
import { flattenLabelDataTags } from "./label-template-model";
import { isBarcodeSource } from "./barcode-source-model";

export interface BarcodeSourceRequest {
  catalog: DataTagCatalog;
  insert(key: string): void;
}

export function bindBarcodeSourceControl({
  root,
  editor,
  commands,
  catalog,
  onOpen,
}: {
  root: HTMLElement;
  editor: TemplateEditorInstance;
  commands: TemplateEditorCommandDispatcher;
  catalog: DataTagCatalog;
  onOpen(request: BarcodeSourceRequest): void;
}) {
  const toolbar = root.querySelector<HTMLElement>(".editor-toolbar");
  if (!toolbar) return () => undefined;
  const definitions = flattenLabelDataTags(catalog);
  let disposed = false;
  const click = (event: MouseEvent) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-template-insert="barcode"]')
        : null;
    if (!button || !toolbar.contains(button) || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    commands.captureSelection();
    onOpen({
      catalog,
      insert: (key) => {
        if (disposed || !definitions.some((tag) => String(tag.key || tag.dataKey) === key && isBarcodeSource(tag)))
          return;
        commands.execute({
          id: "barcode.insert",
          mutate: () => {
            const runtime = editor.getRuntime();
            if (!runtime.insertHtml) return false;
            return (
              runtime.insertHtml(buildGeneratedObjectMarkup("barcode", key, { tagDefinitions: definitions })) !== false
            );
          },
        });
      },
    });
  };
  toolbar.addEventListener("click", click, true);
  return () => {
    disposed = true;
    toolbar.removeEventListener("click", click, true);
  };
}
