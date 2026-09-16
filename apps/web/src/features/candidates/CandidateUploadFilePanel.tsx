import { useRef, useState, type DragEvent, type ReactNode } from "react";

interface Props {
  accept: string;
  label: string;
  file: File | null;
  busy: boolean;
  onChoose(files: File[]): void;
  children?: ReactNode;
}

export function CandidateUploadFilePanel({ accept, label, file, busy, onChoose, children }: Props) {
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  function isFileDrag(event: DragEvent) {
    return event.dataTransfer.types.includes("Files");
  }

  return (
    <div
      className={`candidate-upload-file-panel${dragging && !busy ? " is-dragging" : ""}`}
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!busy) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        if (!busy && isFileDrag(event)) onChoose(Array.from(event.dataTransfer.files));
      }}
    >
      <label title={file?.name}>
        <input
          type="file"
          accept={accept}
          aria-label={label}
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = "";
            if (!busy && files.length) onChoose(files);
          }}
        />
        <span>{dragging && !busy ? "여기에 파일을 놓아 주세요" : file?.name || `${label} 또는 끌어다 놓기`}</span>
      </label>
      {children}
    </div>
  );
}
