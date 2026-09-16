interface JoinedTable {
  block: HTMLElement;
  table: HTMLTableElement;
  width: boolean;
  height: boolean;
  contentWidth: number;
  contentHeight: number;
  clearHeaderBackground: boolean;
  collapseTopBorder: boolean;
}

interface JoinedGrid {
  grid: HTMLElement;
  width: number;
  height: number;
  tables: JoinedTable[];
}

function measureJoinedTables(root: HTMLElement): JoinedGrid[] {
  const view = root.ownerDocument.defaultView;
  if (!view) return [];
  const px = (value: string) => Number.parseFloat(value) || 0;
  return [...root.querySelectorAll<HTMLElement>("[data-candidate-block-grid]")].flatMap((grid) => {
    const gridRect = grid.getBoundingClientRect();
    const gridStyle = view.getComputedStyle(grid);
    const joinColumns = Number.parseFloat(gridStyle.columnGap) === 0;
    const joinRows = Number.parseFloat(gridStyle.rowGap) === 0;
    if ((!joinColumns && !joinRows) || !gridRect.width) return [];
    // Work in document pixels, independently of the canvas zoom.
    const scale = gridRect.width / (px(gridStyle.width) || gridRect.width);
    const tables = [...grid.querySelectorAll<HTMLElement>("[data-candidate-block-instance], [data-candidate-block-column-name]")].flatMap((block): JoinedTable[] => {
      const table = block.querySelector<HTMLTableElement>(":scope > table");
      if (!table || block.querySelectorAll("table").length !== 1) return [];
      if ([...block.children].some((child) => child !== table && view.getComputedStyle(child).display !== "none")) return [];
      if ([...block.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim())) return [];
      const style = view.getComputedStyle(block);
      const rect = block.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const innerWidth = rect.width / scale - px(style.borderLeftWidth) - px(style.borderRightWidth);
      const innerHeight = rect.height / scale - px(style.borderTopWidth) - px(style.borderBottomWidth);
      const width = joinColumns && !px(style.paddingLeft) && !px(style.paddingRight)
        && Math.abs(tableRect.width / scale - innerWidth) <= 2.5;
      const height = joinRows && !px(style.paddingTop) && !px(style.paddingBottom)
        && Math.abs(tableRect.height / scale - innerHeight) <= 2.5;
      const clearHeaderBackground = block.hasAttribute("data-candidate-block-column-name")
        && !block.style.background && !block.style.backgroundColor;
      return width || height ? [{ block, table, width, height, contentWidth: innerWidth, contentHeight: innerHeight, clearHeaderBackground, collapseTopBorder: false }] : [];
    });
    const ordered = tables.map(entry => ({ entry, rect: entry.block.getBoundingClientRect() }))
      .sort((a, b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top);
    for (let index = 1; index < ordered.length; index++) {
      const current = ordered[index], previous = ordered[index - 1];
      if (!current.entry.width || !current.entry.height || !previous.entry.width || !previous.entry.height
        || Math.abs(current.rect.left - previous.rect.left) / scale > 0.1
        || Math.abs(current.rect.right - previous.rect.right) / scale > 0.1
        || Math.abs(current.rect.top - previous.rect.bottom) / scale > 0.1) continue;
      const upperCells = [...previous.entry.table.rows].at(-1)?.cells;
      const lowerCells = current.entry.table.rows[0]?.cells;
      if (!upperCells?.length || !lowerCells?.length) continue;
      const border = view.getComputedStyle(upperCells[0]).borderBottom;
      // Collapse identical shared borders only; keep deliberately different borders.
      current.entry.collapseTopBorder = [...upperCells].every(cell => view.getComputedStyle(cell).borderBottom === border)
        && [...lowerCells].every(cell => view.getComputedStyle(cell).borderTop === border);
    }
    return tables.length ? [{ grid, width: gridRect.width / scale, height: gridRect.height / scale, tables }] : [];
  });
}

export function joinFullSizePrintTables(root: HTMLElement) {
  for (const { grid, width, height, tables } of measureJoinedTables(root)) {
    for (const entry of tables) {
      if (entry.clearHeaderBackground) entry.block.style.backgroundColor = "#ffffff";
      if (entry.collapseTopBorder) {
        for (const element of [entry.table, ...entry.table.rows[0].cells]) {
          element.style.setProperty("border-top-width", "0", "important");
        }
      }
      if (entry.width) {
        entry.block.style.borderLeftWidth = "0";
        entry.block.style.borderRightWidth = "0";
        entry.table.style.setProperty("width", "100%", "important");
      }
      if (entry.height) {
        entry.block.style.borderTopWidth = "0";
        entry.block.style.borderBottomWidth = "0";
        entry.table.style.setProperty("height", "100%", "important");
      }
    }
    grid.style.width = `${width}px`;
    grid.style.height = `${height}px`;
  }
}

let presentationId = 0;

export function bindCanvasTableJoining(root: HTMLElement, surface: HTMLElement) {
  const view = root.ownerDocument.defaultView;
  if (!view) return () => undefined;
  const id = `joined-${++presentationId}`;
  root.dataset.templateJoinedTables = id;
  const style = root.ownerDocument.createElement("style");
  root.append(style);
  let frame = 0;
  const selector = (element: Element) => {
    const path: string[] = [];
    for (let current: Element | null = element; current && current !== surface; current = current.parentElement) {
      path.unshift(`> :nth-child(${[...current.parentElement!.children].indexOf(current) + 1})`);
    }
    return `[data-template-joined-tables="${id}"] [data-template-editor-runtime-surface] ${path.join(" ")}`;
  };
  const refresh = () => {
    frame = 0;
    // Presentation lives outside editable HTML: no saved styles, undo entries,
    // cloned tables or mutations of the editor's content are introduced.
    style.textContent = "";
    const rules: string[] = [];
    for (const { grid, width, height, tables } of measureJoinedTables(surface)) {
      rules.push(`${selector(grid)} { width: ${width}px; height: ${height}px; }`);
      for (const entry of tables) {
        rules.push(`${selector(entry.block)} {
          --template-candidate-block-editor-width: ${entry.contentWidth}px;
          --template-candidate-block-editor-height: ${entry.contentHeight}px;
          ${entry.clearHeaderBackground ? "background-color: #ffffff;" : ""}
          ${entry.width ? "border-left-width: 0; border-right-width: 0;" : ""}
          ${entry.height ? "border-top-width: 0; border-bottom-width: 0;" : ""}
        }`);
        rules.push(`${selector(entry.table)} {
          ${entry.width ? "width: 100% !important;" : ""}
          ${entry.height ? "height: 100% !important;" : ""}
        }`);
        if (entry.collapseTopBorder) {
          rules.push(`${[entry.table, ...entry.table.rows[0].cells].map(selector).join(", ")} { border-top-width: 0 !important; }`);
        }
      }
    }
    style.textContent = rules.join("\n");
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(refresh);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(surface, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style"] });
  view.addEventListener("resize", schedule);
  refresh();
  return () => {
    observer.disconnect();
    view.removeEventListener("resize", schedule);
    if (frame) view.cancelAnimationFrame(frame);
    style.remove();
    delete root.dataset.templateJoinedTables;
  };
}
