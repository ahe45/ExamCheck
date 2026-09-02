export interface TemplatePagePropertiesEnhancement {
  dispose(): void;
}

export function enhanceTemplatePageProperties(root: HTMLElement): TemplatePagePropertiesEnhancement {
  const shell = root.querySelector<HTMLElement>(".template-editor-runtime-shell");
  const panel = shell?.querySelector<HTMLElement>(":scope > .template-page-properties-panel");
  if (!shell || !panel) return { dispose: () => undefined };

  const column = document.createElement("aside");
  column.className = "template-page-properties-column";
  column.setAttribute("aria-label", "페이지 속성");

  shell.insertBefore(column, panel);
  column.append(panel);

  return {
    dispose() {
      if (column.parentElement === shell) shell.insertBefore(panel, column);
      column.remove();
    },
  };
}
