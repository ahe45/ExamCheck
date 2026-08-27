const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export function renderZplTemplate(template: string, values: Record<string, string | number>): string {
  const rendered = template.replace(PLACEHOLDER, (_, key: string) => {
    if (!(key in values)) throw new Error(`Missing template value: ${key}`);
    return sanitizeZplValue(String(values[key]));
  });

  const unresolved = rendered.match(/\{\{[^}]+\}\}/);
  if (unresolved) throw new Error(`Unsupported template expression: ${unresolved[0]}`);
  if (!rendered.startsWith("^XA") || !rendered.endsWith("^XZ")) {
    throw new Error("ZPL template must start with ^XA and end with ^XZ.");
  }
  return rendered;
}

export function sanitizeZplValue(value: string): string {
  return value.replace(/[\^~\r\n]/g, " ").trim();
}
