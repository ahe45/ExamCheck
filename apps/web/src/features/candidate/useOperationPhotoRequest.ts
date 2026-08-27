import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { isCurrentPhotoRequest, type OperationRequestTarget } from "./operation-request-guard";
import type { OperationCandidateAction } from "./operation-candidate-state";

interface OperationTargetRef {
  current: OperationRequestTarget | null;
}

interface PhotoRequest {
  requestId: number;
  target: OperationRequestTarget;
  controller: AbortController;
}

type PhotoLoader = (signal: AbortSignal) => Promise<Blob | null>;

export function useOperationPhotoRequest(
  currentTargetRef: OperationTargetRef,
  dispatch: Dispatch<OperationCandidateAction>,
) {
  const requestSequenceRef = useRef(0);
  const requestRef = useRef<PhotoRequest | null>(null);

  const cancelPhotoRequest = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
    requestSequenceRef.current += 1;
  }, []);

  const requestPhoto = useCallback(
    (target: OperationRequestTarget, loadPhoto: PhotoLoader) => {
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      const controller = new AbortController();
      const request = { requestId, target, controller };
      requestRef.current = request;

      void loadPhoto(controller.signal)
        .then((blob) => {
          if (blob && isCurrentPhotoRequest(request, requestSequenceRef.current, currentTargetRef.current)) {
            dispatch({ type: "PHOTO_RESOLVED", photoUrl: URL.createObjectURL(blob) });
          }
        })
        .catch(() => {
          /* 요청 취소 또는 사진 오류는 사진 없이 계속 표시합니다. */
        })
        .finally(() => {
          if (requestRef.current?.requestId === requestId) requestRef.current = null;
        });
    },
    [currentTargetRef, dispatch],
  );

  return { cancelPhotoRequest, requestPhoto };
}

export function useObjectUrlLifecycle(objectUrl: string | null) {
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);
}
