import { useEffect, useRef } from "react";

interface EscapeLayer {
  id: symbol;
  invoke(): void;
}

const escapeLayers: EscapeLayer[] = [];

function handleEscapeKey(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const topLayer = escapeLayers.at(-1);
  if (!topLayer) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  topLayer.invoke();
}

function registerEscapeLayer(layer: EscapeLayer) {
  if (!escapeLayers.length) document.addEventListener("keydown", handleEscapeKey);
  escapeLayers.push(layer);
  return () => {
    const index = escapeLayers.findIndex((item) => item.id === layer.id);
    if (index >= 0) escapeLayers.splice(index, 1);
    if (!escapeLayers.length) document.removeEventListener("keydown", handleEscapeKey);
  };
}

export function useEscapeKey(active: boolean, onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    return registerEscapeLayer({
      id: Symbol("escape-layer"),
      invoke: () => onEscapeRef.current(),
    });
  }, [active]);
}
