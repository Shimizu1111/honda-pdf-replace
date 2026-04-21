/**
 * PDF.js を使った PDF プレビューレンダリング
 */

import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

let pdfDoc = null;

export function initPdfJs() {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
}

export async function loadPdf(arrayBuffer) {
    const data = new Uint8Array(arrayBuffer instanceof Uint8Array ? arrayBuffer.slice() : arrayBuffer);
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    return { pageCount: pdfDoc.numPages };
}

export async function renderPage(pageNum, scale, canvas) {
    const page = await pdfDoc.getPage(pageNum + 1); // PDF.js は 1-indexed
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    return {
        widthPt: viewport.width / scale,
        heightPt: viewport.height / scale,
    };
}
