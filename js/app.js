import { initPdfJs, loadPdf, renderPage } from "./pdf-preview.js";
import { editPdf } from "./pdf-editor.js";

// --- 状態 ---
let originalPdfBytes = null;
let editedPdfBytes = null;
let fontBytes = null;
let logoBytes = null;
let currentPage = 0;
let pageCount = 0;
let pageWidthPt = 0;
let pageHeightPt = 0;
let zoom = window.innerWidth <= 600 ? 0.8 : 1.5;

// 選択
let isSelecting = false;
let selStart = null;
let selRect = null;
let selElement = null;

// タッチモード: "scroll" (スクロール/ズーム) or "select" (範囲選択)
let touchMode = "scroll";
const isTouchDevice = window.matchMedia("(max-width: 600px)").matches || "ontouchstart" in window;

const COMPANY_INFO = {
    name: "AR株式会社",
    address: "〒106-0032 東京都港区六本木6丁目1-20 7F",
    phone: "TEL: 03-6890-2022",
    email: "MAIL: m.asaka@asaka-real.com",
};

// --- DOM ---
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const previewSection = document.getElementById("previewSection");
const canvas = document.getElementById("previewCanvas");
const overlay = document.getElementById("selectionOverlay");
const previewBtn = document.getElementById("previewBtn");
const downloadBtn = document.getElementById("downloadBtn");
const backBtn = document.getElementById("backBtn");
const statusBar = document.getElementById("statusBar");
const loadingOverlay = document.getElementById("loadingOverlay");

// --- 初期化 ---
async function init() {
    initPdfJs();

    statusBar.textContent = "フォントとロゴを読み込み中...";
    showLoading();

    try {
        const [fontResp, logoResp] = await Promise.all([
            fetch("https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-jp@latest/japanese-400-normal.ttf"),
            fetch("static/logo.png"),
        ]);
        fontBytes = await fontResp.arrayBuffer();
        logoBytes = await logoResp.arrayBuffer();
        statusBar.textContent = "準備完了 — PDFをアップロードしてください";
    } catch (e) {
        statusBar.textContent = "リソース読み込みエラー: " + e.message;
    } finally {
        hideLoading();
    }

    setupEventListeners();
}

function setupEventListeners() {
    // アップロード
    uploadArea.addEventListener("click", () => fileInput.click());
    uploadArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadArea.classList.add("dragover");
    });
    uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("dragover"));
    uploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadArea.classList.remove("dragover");
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", () => {
        if (fileInput.files.length) handleFile(fileInput.files[0]);
    });

    // 選択（マウス）
    overlay.addEventListener("mousedown", onMouseDown);
    overlay.addEventListener("mousemove", onMouseMove);
    overlay.addEventListener("mouseup", onMouseUp);

    // 選択（タッチ） - 選択モード時のみ動作
    overlay.addEventListener("touchstart", onTouchStart, { passive: false });
    overlay.addEventListener("touchmove", onTouchMove, { passive: false });
    overlay.addEventListener("touchend", onTouchEnd, { passive: false });

    // タッチデバイスではデフォルトでスクロールモード（選択オーバーレイ無効化）
    if (isTouchDevice) {
        overlay.classList.add("disabled");
    }

    // ロゴサイズスライダー
    document.getElementById("logoSize").addEventListener("input", (e) => {
        document.getElementById("logoSizeLabel").textContent = e.target.value + "%";
    });

    // モード切替ボタン
    document.getElementById("modeBtn").addEventListener("click", toggleTouchMode);
}

// --- ファイルアップロード ---
async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
        alert("PDFファイルを選択してください");
        return;
    }
    showLoading();

    try {
        originalPdfBytes = new Uint8Array(await file.arrayBuffer());
        const result = await loadPdf(originalPdfBytes);
        pageCount = result.pageCount;
        currentPage = 0;

        setStep(2);
        previewSection.classList.add("visible");
        await renderCurrentPage(originalPdfBytes);
        statusBar.textContent = `${file.name} (${pageCount}ページ) を読み込みました`;
    } catch (e) {
        alert("アップロードに失敗しました: " + e.message);
    } finally {
        hideLoading();
    }
}

// --- ページレンダリング ---
async function renderCurrentPage(pdfBytes) {
    await loadPdf(pdfBytes);
    const dims = await renderPage(currentPage, zoom, canvas);
    pageWidthPt = dims.widthPt;
    pageHeightPt = dims.heightPt;

    overlay.style.width = canvas.width + "px";
    overlay.style.height = canvas.height + "px";
    document.getElementById("canvasWrapper").style.width = canvas.width + "px";
    document.getElementById("canvasWrapper").style.height = canvas.height + "px";

    document.getElementById("pageInfo").textContent = `${currentPage + 1} / ${pageCount}`;
}

// --- ページ送り ---
window.prevPage = async function () {
    if (currentPage > 0) {
        currentPage--;
        showLoading();
        clearSelection();
        await renderCurrentPage(originalPdfBytes);
        hideLoading();
    }
};

window.nextPage = async function () {
    if (currentPage < pageCount - 1) {
        currentPage++;
        showLoading();
        clearSelection();
        await renderCurrentPage(originalPdfBytes);
        hideLoading();
    }
};

// --- 範囲選択 ---
function onMouseDown(e) {
    const rect = overlay.getBoundingClientRect();
    selStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isSelecting = true;

    if (selElement) { selElement.remove(); selElement = null; }
    selRect = null;
    previewBtn.disabled = true;
}

function onMouseMove(e) {
    if (!isSelecting) return;
    const rect = overlay.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const x = Math.min(selStart.x, cx);
    const y = Math.min(selStart.y, cy);
    const w = Math.abs(cx - selStart.x);
    const h = Math.abs(cy - selStart.y);

    if (!selElement) {
        selElement = document.createElement("div");
        selElement.className = "selection-rect";
        overlay.appendChild(selElement);
    }
    selElement.style.left = x + "px";
    selElement.style.top = y + "px";
    selElement.style.width = w + "px";
    selElement.style.height = h + "px";
}

function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;
    const rect = overlay.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const x = Math.min(selStart.x, cx);
    const y = Math.min(selStart.y, cy);
    const w = Math.abs(cx - selStart.x);
    const h = Math.abs(cy - selStart.y);

    if (w < 10 || h < 10) {
        clearSelection();
        return;
    }

    selRect = { x, y, w, h };
    previewBtn.disabled = false;

    const pdfRect = canvasToPdf(selRect);
    statusBar.textContent =
        `選択範囲: x=${pdfRect.x0.toFixed(0)}, y=${pdfRect.y0.toFixed(0)}, ` +
        `幅=${(pdfRect.x1 - pdfRect.x0).toFixed(0)}pt, 高さ=${(pdfRect.y1 - pdfRect.y0).toFixed(0)}pt`;
}

// --- タッチモード切替 ---
function toggleTouchMode() {
    const btn = document.getElementById("modeBtn");
    if (touchMode === "scroll") {
        touchMode = "select";
        overlay.classList.remove("disabled");
        btn.className = "mode-select";
        btn.textContent = "🔍 スクロールモードに切替";
        statusBar.textContent = "選択モード: 指でドラッグして範囲を選択してください";
    } else {
        touchMode = "scroll";
        overlay.classList.add("disabled");
        btn.className = "mode-scroll";
        btn.textContent = "📍 選択モードに切替";
        statusBar.textContent = "スクロールモード: スクロール・ピンチズームで位置を調整してください";
    }
}

// --- タッチイベント ---
function getTouchPos(e) {
    const touch = e.touches[0] || e.changedTouches[0];
    const rect = overlay.getBoundingClientRect();
    return { clientX: touch.clientX, clientY: touch.clientY, x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

function onTouchStart(e) {
    if (touchMode !== "select") return;
    e.preventDefault();
    const pos = getTouchPos(e);
    onMouseDown({ clientX: pos.clientX, clientY: pos.clientY, preventDefault: () => {} });
}

function onTouchMove(e) {
    if (touchMode !== "select") return;
    e.preventDefault();
    const pos = getTouchPos(e);
    onMouseMove({ clientX: pos.clientX, clientY: pos.clientY });
}

function onTouchEnd(e) {
    if (touchMode !== "select") return;
    e.preventDefault();
    const pos = getTouchPos(e);
    onMouseUp({ clientX: pos.clientX, clientY: pos.clientY });
}

window.clearSelection = function () {
    if (selElement) { selElement.remove(); selElement = null; }
    selRect = null;
    previewBtn.disabled = true;
    if (originalPdfBytes) setStep(2);
};

function canvasToPdf(sel) {
    return {
        x0: (sel.x / canvas.width) * pageWidthPt,
        y0: (sel.y / canvas.height) * pageHeightPt,
        x1: ((sel.x + sel.w) / canvas.width) * pageWidthPt,
        y1: ((sel.y + sel.h) / canvas.height) * pageHeightPt,
    };
}

// --- プレビュー ---
window.previewReplace = async function () {
    if (!selRect) return;
    showLoading();

    try {
        const pdfRect = canvasToPdf(selRect);
        editedPdfBytes = await editPdf(originalPdfBytes, {
            pageNum: currentPage,
            rect: pdfRect,
            logoBytes: new Uint8Array(logoBytes),
            fontBytes: new Uint8Array(fontBytes),
            fontSize: parseFloat(document.getElementById("fontSize").value) || 8,
            logoSizePercent: parseInt(document.getElementById("logoSize").value) || 30,
            logoOffsetX: parseFloat(document.getElementById("logoOffsetX").value) || 0,
            showText: document.getElementById("showText").checked,
            companyInfo: COMPANY_INFO,
        });

        await renderCurrentPage(editedPdfBytes);

        if (selElement) selElement.style.display = "none";
        overlay.style.pointerEvents = "none";
        previewBtn.style.display = "none";
        downloadBtn.style.display = "";
        backBtn.style.display = "";
        setStep(3);
        statusBar.textContent = "プレビューを表示中 — 問題なければダウンロードしてください";
    } catch (e) {
        alert("プレビューに失敗しました: " + e.message);
        console.error(e);
    } finally {
        hideLoading();
    }
};

// --- ダウンロード ---
window.downloadEdited = function () {
    if (!editedPdfBytes) return;
    const blob = new Blob([editedPdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "edited.pdf";
    a.click();
    URL.revokeObjectURL(url);
    setStep(4);
    statusBar.textContent = "ダウンロード完了！";
};

// --- 戻る ---
window.backToEdit = async function () {
    previewBtn.style.display = "";
    downloadBtn.style.display = "none";
    backBtn.style.display = "none";
    overlay.style.pointerEvents = "";
    clearSelection();
    showLoading();
    await renderCurrentPage(originalPdfBytes);
    hideLoading();
    setStep(2);
    statusBar.textContent = "範囲を再選択してください";
};

// --- UI ヘルパー ---
function setStep(n) {
    document.querySelectorAll(".step").forEach((el, i) => {
        el.classList.remove("active", "done");
        if (i + 1 < n) el.classList.add("done");
        else if (i + 1 === n) el.classList.add("active");
    });
}

function showLoading() { loadingOverlay.classList.add("visible"); }
function hideLoading() { loadingOverlay.classList.remove("visible"); }

// --- 起動 ---
init();
