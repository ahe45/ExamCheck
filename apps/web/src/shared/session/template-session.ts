export const FORM_EDITOR_SESSION_KEY = "examcheck.form-template-editor.session.v1";
export const LABEL_EDITOR_SESSION_KEY = "examcheck.label-template-editor.session.v1";
export const TEMPLATE_TAB_SESSION_KEY = "examcheck.template-tab.session.v1";

export function readTemplateSession(key: string): unknown {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function writeTemplateSession(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked or full; editing must remain available.
  }
}

export function clearTemplateSession(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be blocked.
  }
}
