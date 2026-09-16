// SVG-based capture must carry webfonts inside the page, otherwise it falls back
// to installed fonts even when the live document has already loaded the correct font.
export async function embedLoadedPrintFonts(
  page: HTMLElement,
  cache: Map<string, Promise<string>>,
  signal?: AbortSignal,
) {
  const doc = page.ownerDocument;
  if (!doc.fonts) return;
  const normalize = (value: string) => value.replace(/["'\s]/g, "").toLowerCase();
  const loaded = [...doc.fonts].filter((font) => font.status === "loaded");
  const rules = [...doc.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules].filter((rule): rule is CSSFontFaceRule => rule.type === CSSRule.FONT_FACE_RULE);
      } catch {
        return [];
      }
    })
    .filter((rule) =>
      loaded.some(
        (font) =>
          normalize(font.family) === normalize(rule.style.getPropertyValue("font-family")) &&
          normalize(font.unicodeRange) === normalize(rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF"),
      ),
    );
  const css = await Promise.all(
    rules.map(async (rule) => {
      let text = rule.cssText;
      for (const match of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const url = new URL(match[1], doc.baseURI).href;
        if (url.startsWith("data:")) continue;
        let pending = cache.get(url);
        if (!pending) {
          pending = fetch(url, { signal }).then(async (response) => {
            if (!response.ok) throw new Error("PDF에 사용할 글꼴을 불러오지 못했습니다.");
            const blob = await response.blob();
            return new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("PDF 글꼴을 준비하지 못했습니다."));
              reader.readAsDataURL(blob);
            });
          });
          cache.set(url, pending);
        }
        text = text.replace(match[0], `url("${await pending}")`);
      }
      return text;
    }),
  );
  if (!css.length) return;
  const style = doc.createElement("style");
  style.textContent = css.join("\n");
  page.append(style);
  await doc.fonts.ready;
}
