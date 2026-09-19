import { z } from "zod";
import {
  LABEL_EDITOR_SESSION_KEY,
  readTemplateSession,
  writeTemplateSession,
} from "../../shared/session/template-session";

// Only the open editor is restored. Legacy draft contents are intentionally ignored.
const sessionSchema = z.object({
  sourceCode: z.string().min(1).nullable(),
});

export type LabelEditorSession = z.infer<typeof sessionSchema>;

export function readLabelEditorSession(): LabelEditorSession | null {
  const result = sessionSchema.safeParse(readTemplateSession(LABEL_EDITOR_SESSION_KEY));
  return result.success ? result.data : null;
}

export function persistLabelEditorSession(session: LabelEditorSession) {
  writeTemplateSession(LABEL_EDITOR_SESSION_KEY, session);
}
