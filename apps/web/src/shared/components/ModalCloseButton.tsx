import type { ButtonHTMLAttributes } from "react";

type ModalCloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "type">;

export function ModalCloseButton({ "aria-label": label = "닫기", ...props }: ModalCloseButtonProps) {
  return (
    <button {...props} type="button" className="exam-modal-close" aria-label={label}>
      ×
    </button>
  );
}
