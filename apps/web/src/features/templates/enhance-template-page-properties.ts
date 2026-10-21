export interface TemplatePagePropertiesEnhancement {
  actionsHost: HTMLElement | null;
  dispose(): void;
}

export function enhanceTemplatePageProperties(root: HTMLElement): TemplatePagePropertiesEnhancement {
  const shell = root.querySelector<HTMLElement>(".template-editor-runtime-shell");
  const panel = shell?.querySelector<HTMLElement>(":scope > .template-page-properties-panel");
  if (!shell || !panel) return { actionsHost: null, dispose: () => undefined };

  const column = document.createElement("aside");
  column.className = "template-page-properties-column";
  column.setAttribute("aria-label", "페이지 속성");

  shell.insertBefore(column, panel);
  column.append(panel);
  const actionsHost = document.createElement("footer");
  actionsHost.className = "template-editor-panel-footer";
  actionsHost.setAttribute("aria-label", "양식 작업");
  column.append(actionsHost);

  return {
    actionsHost,
    dispose() {
      if (column.parentElement === shell) shell.insertBefore(panel, column);
      column.remove();
    },
  };
}
