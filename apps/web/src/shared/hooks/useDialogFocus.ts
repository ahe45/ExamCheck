import { useEffect, useRef, type RefObject } from "react";

interface DialogLayer {
  container: HTMLElement;
  id: symbol;
  restoreTarget: HTMLElement | null;
}

interface OutsideElementState {
  ariaHidden: string | null;
  inert: string | null;
}

const dialogLayers: DialogLayer[] = [];
const outsideElementStates = new Map<HTMLElement, OutsideElementState>();
let originalBodyOverflow: string | null = null;

const focusableSelector = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true" && !element.closest("[inert]"),
  );
}

function focusFirst(container: HTMLElement) {
  const focusable = focusableElements(container);
  const currentFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const explicitFocus = container.querySelector<HTMLElement>("[data-dialog-autofocus], [autofocus]");
  const preferred = explicitFocus ?? (currentFocus && container.contains(currentFocus) ? currentFocus : null);
  const target = preferred && focusable.includes(preferred) ? preferred : focusable[0];
  if (target) {
    target.focus({ preventScroll: true });
    return;
  }
  if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
  container.focus({ preventScroll: true });
}

function handleDialogTab(event: KeyboardEvent) {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const topLayer = dialogLayers.at(-1);
  if (!topLayer) return;
  const focusable = focusableElements(topLayer.container);
  const toastViewport = document.querySelector<HTMLElement>("[data-app-toast-viewport]");
  const toastControls = toastViewport ? focusableElements(toastViewport) : [];
  if (toastControls.length) {
    const controls = [...focusable, ...toastControls];
    const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      activeIndex < 0
        ? event.shiftKey
          ? controls.length - 1
          : 0
        : (activeIndex + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    event.preventDefault();
    event.stopImmediatePropagation();
    controls[nextIndex].focus({ preventScroll: true });
    return;
  }
  if (!focusable.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    focusFirst(topLayer.container);
    return;
  }

  const activeElement = document.activeElement;
  const first = focusable[0];
  const last = focusable.at(-1) ?? first;
  const focusOutsideTopDialog = !(activeElement instanceof Node) || !topLayer.container.contains(activeElement);
  const shouldWrapBackward = event.shiftKey && (activeElement === first || focusOutsideTopDialog);
  const shouldWrapForward = !event.shiftKey && (activeElement === last || focusOutsideTopDialog);
  if (!shouldWrapBackward && !shouldWrapForward) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  (shouldWrapBackward ? last : first).focus({ preventScroll: true });
}

function lockBodyScroll() {
  if (dialogLayers.length) return;
  originalBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", handleDialogTab);
}

function registerDialogLayer(layer: DialogLayer) {
  lockBodyScroll();
  dialogLayers.push(layer);
  syncOutsideInteractivity();
}

function unregisterDialogLayer(layer: DialogLayer) {
  const index = dialogLayers.findIndex((item) => item.id === layer.id);
  if (index < 0) return;
  const wasTopLayer = index === dialogLayers.length - 1;
  const nextLayer = dialogLayers[index + 1];
  if (nextLayer && layer.restoreTarget && layer.container.contains(nextLayer.restoreTarget)) {
    nextLayer.restoreTarget = layer.restoreTarget;
  }
  dialogLayers.splice(index, 1);
  syncOutsideInteractivity();

  if (!dialogLayers.length) {
    document.removeEventListener("keydown", handleDialogTab);
    document.body.style.overflow = originalBodyOverflow ?? "";
    originalBodyOverflow = null;
  }

  if (!wasTopLayer || !layer.restoreTarget) return;
  const restoreTarget = layer.restoreTarget;
  queueMicrotask(() => {
    if (!restoreTarget.isConnected) return;
    const currentTop = dialogLayers.at(-1);
    if (currentTop && !currentTop.container.contains(restoreTarget)) return;
    restoreTarget.focus({ preventScroll: true });
  });
}

function syncOutsideInteractivity() {
  restoreOutsideInteractivity();
  const topLayer = dialogLayers.at(-1);
  if (!topLayer?.container.isConnected) return;

  let activeBranch: HTMLElement = topLayer.container;
  while (activeBranch !== document.body) {
    const parent = activeBranch.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling !== activeBranch && sibling instanceof HTMLElement) hideOutsideElement(sibling);
    }
    activeBranch = parent;
  }
}

function hideOutsideElement(element: HTMLElement) {
  if (element.matches("[data-app-toast-viewport], #examlist-toast-root")) return;
  outsideElementStates.set(element, {
    ariaHidden: element.getAttribute("aria-hidden"),
    inert: element.getAttribute("inert"),
  });
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
}

function restoreOutsideInteractivity() {
  for (const [element, state] of outsideElementStates) {
    restoreAttribute(element, "aria-hidden", state.ariaHidden);
    restoreAttribute(element, "inert", state.inert);
  }
  outsideElementStates.clear();
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

export function useDialogFocus<T extends HTMLElement>(active = true): RefObject<T | null> {
  const dialogRef = useRef<T>(null);

  useEffect(() => {
    const container = dialogRef.current;
    if (!active || !container) return;
    const layer: DialogLayer = {
      container,
      id: Symbol("dialog-layer"),
      restoreTarget: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    registerDialogLayer(layer);
    focusFirst(container);
    return () => unregisterDialogLayer(layer);
  }, [active]);

  return dialogRef;
}
