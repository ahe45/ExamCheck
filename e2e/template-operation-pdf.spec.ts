import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("인쇄 데이터는 태그 배지 너비가 아닌 문단과 셀의 너비에 맞춰 흐른다", async ({ page }) => {
  await page.goto("/");
  const popupPending = page.waitForEvent("popup");
  await page.evaluate(async () => {
    const path = "/src/features/templates/template-renderer.ts";
    const { renderTemplateHtml, openTemplatePrintWindow } = await import(/* @vite-ignore */ path);
    const tag = (key: string, label: string) =>
      `<span class="template-token" data-template-tag-value="${key}" style="font-size:16px;font-weight:700;color:rgb(20,40,60);line-height:20px;width:25px;max-width:25px">${label}</span>`;
    const html = `<div class="template-doc">
      <div id="heading">${tag("year", "년도")} 학년도 ${tag("school", "학교")} ${tag("admission", "전형")}</div>
      <p id="mixed"><b>전형: </b>${tag("admission", "전형")}<b> / </b>${tag("school", "학교")}</p>
      <div id="nested"><b>대기실: </b><span>${tag("room", "실")}</span></div>
      <table style="width:400px;table-layout:fixed"><tr><td>${tag("admission", "전형")}</td></tr></table>
      <div id="narrow" style="width:90px">${tag("long", "전형")}</div>
      <div id="natural-cases" style="font-size:16px;font-weight:700;line-height:20px;color:rgb(20,40,60)">
        <div data-natural>${tag("year", "년도")}학년도 ${tag("school", "학교")} · ${tag("admission", "전형")}</div>
        <div data-reference>2027학년도 한국대학교 · 학생부교과 면접</div>
        <p data-natural>전형:${tag("admission", "전형")} / 대기실:${tag("room", "실")}</p>
        <p data-reference>전형:학생부교과 면접 / 대기실:면접고사실</p>
        <div data-natural>가번호 부여대장 [${tag("empty", "조")}]</div>
        <div data-reference>가번호 부여대장 []</div>
      </div>
      <img id="photo" class="template-token" style="width:42px;height:50px" alt="사진">
    </div>`;
    const rendered = renderTemplateHtml(html, {
      year: "2027",
      school: "한국대학교",
      admission: "학생부교과 면접",
      room: "면접고사실",
      long: "학생부교과 면접 전형의 긴 안내 문구입니다",
      empty: "",
    });
    (window as typeof window & { tagFlowHtml: string }).tagFlowHtml = rendered;
    openTemplatePrintWindow("태그 줄바꿈 검증", rendered);
  });
  const popup = await popupPending;
  await popup.waitForLoadState();
  // A text range measures actual line fragments, including nested/mixed content.
  const measure = (doc: Document) => {
    const lines = (element: Element) => {
      const range = doc.createRange();
      range.selectNodeContents(element);
      return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    };
    const short = [...doc.querySelectorAll<HTMLElement>(".template-token:not(img)")].filter(
      (el) => !el.closest("#narrow") && el.textContent,
    );
    const characters = (element: Element) => {
      const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const origin = element.getBoundingClientRect().left;
      const rects: Array<{ x: number; y: number }> = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        for (let i = 0; i < (node.textContent?.length || 0); i++) {
          const range = doc.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getBoundingClientRect();
          rects.push({ x: rect.left - origin, y: rect.top });
        }
      }
      return rects.map((rect) => ({ x: rect.x, y: rect.y - rects[0].y }));
    };
    return {
      natural: [...doc.querySelectorAll("[data-natural]")].map(characters),
      reference: [...doc.querySelectorAll("[data-reference]")].map(characters),
      short: short.map((el) => ({
        lines: lines(el),
        fontSize: doc.defaultView!.getComputedStyle(el).fontSize,
        fontWeight: doc.defaultView!.getComputedStyle(el).fontWeight,
        color: doc.defaultView!.getComputedStyle(el).color,
      })),
      narrowLines: lines(doc.querySelector("#narrow .template-token")!),
      narrowOverflow: doc.querySelector("#narrow")!.scrollWidth > 91,
      photoWidth: doc.querySelector("#photo")!.getBoundingClientRect().width,
    };
  };
  const preview = await popup.evaluate(
    (source) => new Function("return (" + source + ")")()(document),
    measure.toString(),
  );
  const pending = page.waitForEvent("download");
  const pdf = await page.evaluate(async (measureSource) => {
    const path = "/src/features/templates/template-renderer.ts";
    const { downloadTemplatePdf } = await import(/* @vite-ignore */ path);
    const measureDocument = new Function("return (" + measureSource + ")")();
    let snapshot;
    const capturedSvgs: string[] = [];
    const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...imageSrc,
      set(value: string) {
        if (value.startsWith("data:image/svg+xml")) capturedSvgs.push(value);
        imageSrc.set!.call(this, value);
      },
    });
    const html = (window as typeof window & { tagFlowHtml: string }).tagFlowHtml;
    await downloadTemplatePdf("태그 줄바꿈 검증", [html], html, {
      onProgress: () => {
        const frame = document.querySelector<HTMLIFrameElement>('iframe[title="PDF 인쇄 준비"]')!;
        snapshot = measureDocument(frame.contentDocument);
      },
    });
    Object.defineProperty(HTMLImageElement.prototype, "src", imageSrc);
    return { snapshot, capturedSvgs };
  }, measure.toString());
  for (const result of [preview, pdf.snapshot]) {
    for (const token of result.short)
      expect(token).toEqual({
        lines: 1,
        fontSize: "16px",
        fontWeight: "700",
        color: "rgb(20, 40, 60)",
      });
    expect(result.narrowLines).toBeGreaterThan(1);
    expect(result.narrowOverflow).toBe(false);
    expect(result.photoWidth).toBe(42);
  }
  // Inspect the final foreignObject, not just the source iframe: html2canvas
  // removes styles during cloning, after source geometry has already passed.
  expect(pdf.capturedSvgs).toHaveLength(1);
  const finalCapture = decodeURIComponent(pdf.capturedSvgs[0].split(",").slice(1).join(","));
  expect(finalCapture.includes("width: auto !important")).toBe(true);
  const capturedPage = await page.context().newPage();
  await capturedPage.setContent(finalCapture);
  const capturedLayout = await capturedPage.evaluate(
    (source) => new Function("return (" + source + ")")()(document),
    measure.toString(),
  );
  expect(capturedLayout.short.every((token: { lines: number }) => token.lines === 1)).toBe(true);
  expect(capturedLayout.narrowLines).toBeGreaterThan(1);
  for (const result of [preview, pdf.snapshot, capturedLayout]) {
    for (let i = 0; i < result.natural.length; i++) {
      expect(result.natural[i]).toHaveLength(result.reference[i].length);
      result.natural[i].forEach((rect: { x: number; y: number }, j: number) => {
        expect(Math.abs(rect.x - result.reference[i][j].x)).toBeLessThan(0.5);
        expect(Math.abs(rect.y - result.reference[i][j].y)).toBeLessThan(0.5);
      });
    }
  }
  await capturedPage.close();
  expect((await pending).suggestedFilename()).toContain("태그 줄바꿈 검증");
  await popup.close();
});

test("태그가 포함된 행과 데이터 블록의 간격을 편집 화면과 PDF에서 동일하게 유지한다", async ({ page }) => {
  await page.goto("/");
  const pending = page.waitForEvent("download");
  const result = await page.evaluate(async () => {
    const rendererPath = "/src/features/templates/template-renderer.ts";
    const presentationPath = "/src/features/templates/template-print-presentation.ts";
    const { downloadTemplatePdf } = await import(/* @vite-ignore */ rendererPath);
    const { getTemplatePrintPresentation } = await import(/* @vite-ignore */ presentationPath);
    const tag =
      '<span class="template-token" style="font-size:14.6667px;font-weight:700;line-height:16px">면접고사실</span>';
    const html =
      '<div class="template-doc"><div style="font-size:14.6667px;line-height:16px">' +
      "<div>2027 학년도 " +
      tag +
      "</div><div><br></div>" +
      '<div style="text-align:center"><b style="font-size:20pt">가번호 부여대장</b></div><div><br></div>' +
      ["전형구분", "모집단위", "실기종목", "수험생 대기실"]
        .map((label) => '<div class="qa-line"><b>◆ ' + label + " : </b>" + tag + "</div>")
        .join("") +
      '</div><div data-candidate-block-grid style="position:absolute;top:174px;width:716px;height:100px">표</div></div>';
    const measure = (root: HTMLElement) => {
      const origin = root.querySelector(".template-doc")!.getBoundingClientRect().top;
      const lines = [...root.querySelectorAll(".qa-line")].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - origin, height: r.height, bottom: r.bottom - origin };
      });
      const gridTop = root.querySelector("[data-candidate-block-grid]")!.getBoundingClientRect().top - origin;
      return { lines, gridTop, gap: gridTop - lines.at(-1)!.bottom };
    };
    // Use the editor's original inline box styling as the baseline, with the
    // same wrapper geometry but without print overrides or the live user's DOM.
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:-10000px;width:794px;height:1123px";
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.head.innerHTML =
      "<style>*{box-sizing:border-box}body{margin:0}" + getTemplatePrintPresentation(html).css + "</style>";
    doc.body.innerHTML =
      '<main class="examlist-template-editor" style="width:794px;padding:38px"><div class="editor-document-surface template-editor-surface">' +
      html +
      "</div></main>";
    const baseline = measure(doc.body);
    let pdf;
    await downloadTemplatePdf("태그 행 간격 검증", [html], html, {
      onProgress: () => {
        const printDoc = document.querySelector<HTMLIFrameElement>('iframe[title="PDF 인쇄 준비"]')!.contentDocument!;
        pdf = measure(printDoc.body);
      },
    });
    // The preview uses these same presentation rules; measure it independently.
    doc.querySelector("main")!.classList.add("print-document");
    const preview = measure(doc.body);
    frame.remove();
    return { baseline, preview, pdf };
  });
  expect(result.preview).toEqual(result.baseline);
  expect(result.pdf).toEqual(result.baseline);
  expect(result.baseline.lines[0].height).toBeGreaterThan(16);
  await pending;
});

test("20행 운영 양식의 30명을 동일한 배치의 2페이지 PDF로 출력한다", async ({ page }) => {
  await page.goto("/");
  await page.route("**/api/v1/**", (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({ status: 409, json: { message: "Test writes disabled" } }),
  );
  const pending = page.waitForEvent("download");
  const geometry = await page.evaluate(async () => {
    const pageBuilderPath = "/src/features/candidate/operation-template-pages.ts";
    const rendererPath = "/src/features/templates/template-renderer.ts";
    const { buildOperationTemplatePages } = await import(/* @vite-ignore */ pageBuilderPath);
    const { downloadTemplatePdf } = await import(/* @vite-ignore */ rendererPath);
    const block =
      '<table style="width:713px;height:36px;border-collapse:collapse"><tbody><tr style="height:36px"><td style="width:200px;border:1px solid black;padding:0">{{candidate.examNo}}</td><td style="border:1px solid black;padding:0">{{candidate.name}}</td></tr></tbody></table>';
    const blocks = Array.from(
      { length: 20 },
      (_, i) =>
        '<div class="examlist-candidate-block" data-candidate-block-instance="' +
        (i + 1) +
        '" style="grid-area:' +
        (i + 2) +
        '/1">' +
        block +
        "</div>",
    ).join("");
    const html =
      '<div class="template-doc" data-template-page-size="A4" data-template-page-margin-top="10" data-template-page-margin-right="10" data-template-page-margin-bottom="10" data-template-page-margin-left="10"><h1>가번호 부여대장</h1><div class="examlist-candidate-block-grid has-candidate-block-column-name-row" data-candidate-block-grid="true" data-candidate-block-columns="1" data-candidate-block-rows="20" style="position:absolute;top:174px;left:0;width:716px;height:816px;display:grid;grid-template-columns:1fr;grid-template-rows:36px repeat(20,39px);gap:0"><div class="examlist-candidate-block" data-candidate-block-column-name="true">수험번호 / 이름</div>' +
      blocks +
      '</div><table style="position:absolute;top:1011px;width:716px;height:33px"><tr><td>작성자</td></tr></table></div>';
    const template = {
      usageScope: "CANDIDATE",
      layout: {
        layout: {
          pages: [
            {
              type: "content",
              settings: {
                documentHtml: html,
                candidateBlockGrid: { columns: 1, rows: 20, fillEmptyBlocks: false },
                pageNumber: { enabled: true, preset: "numericCurrentTotal" },
              },
            },
          ],
        },
      },
    };
    const rows = Array.from({ length: 30 }, (_, i) => ({
      candidate: { examineeNo: String(10001 + i), name: "수험생" + (i + 1) },
      assignment: null,
    }));
    const pages = await buildOperationTemplatePages(template, rows, {
      token: "test",
      systemProfile: { schoolName: "학교", systemName: "시험", academicYear: 2026 },
      schedule: { date: "2026-10-30", time: "10:00" },
      examName: "면접",
      operationClosed: true,
    });
    const snapshots: Array<{
      width: number;
      height: number;
      gridTop: string;
      gridHeight: number;
      footerTop: string;
      visible: number;
      names: string[];
      pageNumber: string | null;
      columns: string;
      overflow: boolean;
    }> = [];
    await downloadTemplatePdf("30명 운영 인쇄 검증", pages, template.layout, {
      onProgress: () => {
        const doc = (document.querySelector('iframe[title="PDF 인쇄 준비"]') as HTMLIFrameElement).contentDocument!;
        const paper = doc.querySelector(".generated-pdf-page")!.getBoundingClientRect();
        const grid = doc.querySelector<HTMLElement>("[data-candidate-block-grid]")!;
        const footer = doc.querySelector<HTMLElement>(".template-doc > table")!;
        const slots = [...grid.querySelectorAll<HTMLElement>("[data-candidate-block-instance]")].filter(
          (slot) => slot.style.visibility !== "hidden",
        );
        snapshots.push({
          width: paper.width,
          height: paper.height,
          gridTop: grid.style.top,
          gridHeight: grid.getBoundingClientRect().height,
          footerTop: footer.style.top,
          visible: slots.length,
          names: slots.map((slot) => slot.querySelector("td")!.textContent!),
          pageNumber: doc.querySelector(".generated-pdf-page-number")!.textContent,
          columns: doc.defaultView!.getComputedStyle(grid).display,
          overflow: footer.getBoundingClientRect().bottom > paper.bottom,
        });
      },
    });
    return snapshots;
  });
  expect(geometry.map((x) => x.visible)).toEqual([20, 10]);
  expect(geometry.map((x) => x.pageNumber)).toEqual(["1/2", "2/2"]);
  expect(geometry.flatMap((x) => x.names)).toEqual(Array.from({ length: 30 }, (_, i) => String(10001 + i)));
  for (const page of geometry)
    expect(page).toMatchObject({
      width: 794,
      height: 1123,
      gridTop: "174px",
      gridHeight: 816,
      footerTop: "1011px",
      columns: "grid",
      overflow: false,
    });
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  const pdf = await readFile(path!);
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
});
