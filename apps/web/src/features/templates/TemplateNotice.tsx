import { ToastNotice, type ToastNoticeValue } from "../../shared/components/ToastNotice";

export type TemplateNoticeValue = ToastNoticeValue;

export function TemplateNotice({ notice, onClose }: { notice: TemplateNoticeValue; onClose(): void }) {
  return <ToastNotice notice={notice} onClose={onClose} />;
}
