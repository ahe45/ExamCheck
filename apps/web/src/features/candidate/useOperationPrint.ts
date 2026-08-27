import { useEffect, useRef, useState } from "react";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import type { OperationSchedule } from "../../shared/api/examinees";
import { fetchActiveFormTemplates, type FormTemplate } from "../../shared/api/form-templates";
import type { OperationNotice } from "./operation-candidate-state";
import { buildOperationTemplatePages } from "./operation-template-pages";
import type { OperationRow } from "./operation-view-model";
import { downloadTemplatePdf } from "../templates/template-renderer";
import { isAbortError } from "../../shared/async/bounded-map";

export interface OperationPrintProgress {
  label: string;
  completed: number;
  total: number;
}

interface Options {
  token: string;
  systemProfile: DeveloperSettings;
  examName: string;
  schedule: OperationSchedule;
  scheduleKey: string;
  rows: OperationRow[];
  statusLoaded: boolean;
  operationClosed: boolean;
  isCurrentSchedule(scheduleKey: string): boolean;
  onNotice(notice: OperationNotice | null): void;
}

export function useOperationPrint(options: Options) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<OperationPrintProgress | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    generationControllerRef.current?.abort(new DOMException("교시가 변경되어 PDF 생성을 취소했습니다.", "AbortError"));
    generationControllerRef.current = null;
    setLoading(false);
    setGenerating(false);
    setProgress(null);
    setOpen(false);
  }, [options.scheduleKey]);

  useEffect(
    () => () => {
      generationControllerRef.current?.abort(new DOMException("화면을 벗어나 PDF 생성을 취소했습니다.", "AbortError"));
      generationControllerRef.current = null;
    },
    [],
  );

  async function show() {
    if (!options.statusLoaded || !options.operationClosed) {
      options.onNotice({ kind: "error", text: "등록 완료(마감) 후에 인쇄할 수 있습니다." });
      return;
    }
    const requestScheduleKey = options.scheduleKey;
    setOpen(true);
    setLoading(true);
    options.onNotice(null);
    try {
      const nextTemplates = await fetchActiveFormTemplates(options.token);
      if (!options.isCurrentSchedule(requestScheduleKey)) return;
      setTemplates(nextTemplates);
      setSelectedTemplateCode((current) =>
        nextTemplates.some((item) => item.code === current) ? current : nextTemplates[0]?.code || "",
      );
    } catch (reason) {
      if (options.isCurrentSchedule(requestScheduleKey)) {
        options.onNotice({
          kind: "error",
          text: reason instanceof Error ? reason.message : "등록된 양식을 불러오지 못했습니다.",
        });
        setOpen(false);
      }
    } finally {
      if (options.isCurrentSchedule(requestScheduleKey)) setLoading(false);
    }
  }

  async function generate() {
    const template = templates.find((item) => item.code === selectedTemplateCode);
    if (!template || generating) return;
    const requestScheduleKey = options.scheduleKey;
    const controller = new AbortController();
    generationControllerRef.current?.abort(new DOMException("새 PDF 생성을 시작했습니다.", "AbortError"));
    generationControllerRef.current = controller;
    setGenerating(true);
    setProgress({ label: "출력 데이터를 준비하고 있습니다.", completed: 0, total: Math.max(options.rows.length, 1) });
    options.onNotice(null);
    try {
      const pages = await buildOperationTemplatePages(template, options.rows, {
        token: options.token,
        systemProfile: options.systemProfile,
        schedule: options.schedule,
        examName: options.examName,
        operationClosed: options.operationClosed,
        signal: controller.signal,
        onPhotoProgress: (completed, total) => {
          if (generationControllerRef.current === controller) {
            setProgress({ label: "수험생 사진을 준비하고 있습니다.", completed, total });
          }
        },
      });
      if (!isActiveGeneration(controller, requestScheduleKey)) return;
      setProgress({ label: "PDF 페이지를 생성하고 있습니다.", completed: 0, total: pages.length });
      await downloadTemplatePdf(
        `${options.schedule.admissionName}_${options.schedule.date}_${options.schedule.periodName}_${template.name}`,
        pages,
        template.layout,
        {
          signal: controller.signal,
          onProgress: (completed, total) => {
            if (generationControllerRef.current === controller) {
              setProgress({ label: "PDF 페이지를 생성하고 있습니다.", completed, total });
            }
          },
        },
      );
      if (!isActiveGeneration(controller, requestScheduleKey)) return;
      setOpen(false);
      options.onNotice({
        kind: "success",
        text: `${template.name} 양식으로 PDF ${pages.length}페이지를 생성했습니다.`,
      });
    } catch (reason) {
      if (!isAbortError(reason) && options.isCurrentSchedule(requestScheduleKey)) {
        options.onNotice({
          kind: "error",
          text: reason instanceof Error ? reason.message : "PDF를 생성하지 못했습니다.",
        });
      }
    } finally {
      if (generationControllerRef.current === controller) {
        generationControllerRef.current = null;
        if (options.isCurrentSchedule(requestScheduleKey)) {
          setGenerating(false);
          setProgress(null);
        }
      }
    }
  }

  function close() {
    generationControllerRef.current?.abort(new DOMException("사용자가 PDF 생성을 취소했습니다.", "AbortError"));
    generationControllerRef.current = null;
    setGenerating(false);
    setProgress(null);
    setOpen(false);
  }

  function isActiveGeneration(controller: AbortController, requestScheduleKey: string) {
    return (
      generationControllerRef.current === controller &&
      !controller.signal.aborted &&
      options.isCurrentSchedule(requestScheduleKey)
    );
  }

  return {
    open,
    templates,
    selectedTemplateCode,
    loading,
    generating,
    progress,
    setSelectedTemplateCode,
    show,
    generate,
    close,
  };
}
