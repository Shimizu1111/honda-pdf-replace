/**
 * pdf-lib を使った PDF 編集（白塗り＋ロゴ＋テキスト挿入）
 */

const { PDFDocument, rgb } = PDFLib;

export async function editPdf(originalBytes, options) {
    const {
        pageNum,
        rect,           // {x0, y0, x1, y1} in PDF points (top-left origin)
        logoBytes,
        fontBytes,
        fontSize = 8,
        logoSizePercent = 30,
        logoOffsetX = 0,
        showText = true,
        companyInfo,
    } = options;

    const pdfDoc = await PDFDocument.load(originalBytes);
    pdfDoc.registerFontkit(fontkit);
    const page = pdfDoc.getPages()[pageNum];
    const { height: pageHeight } = page.getSize();

    // top-left → bottom-left 座標変換
    const x0 = rect.x0;
    const y0 = pageHeight - rect.y1;  // bottom in pdf-lib coords
    const x1 = rect.x1;
    const y1 = pageHeight - rect.y0;  // top in pdf-lib coords
    const w = x1 - x0;
    const h = y1 - y0;

    const margin = 2;
    const gap = fontSize * 2;
    const logoRatio = Math.max(0.1, Math.min(0.9, logoSizePercent / 100));

    // 1. 白塗り
    page.drawRectangle({
        x: x0, y: y0, width: w, height: h,
        color: rgb(1, 1, 1),
        borderColor: rgb(1, 1, 1),
        borderWidth: 0,
    });

    // テキスト情報を計算し、枠に収まるよう自動縮小
    const nameColor = rgb(0x16 / 255, 0x4b / 255, 0x7d / 255);
    const lines = [
        companyInfo.name,
        companyInfo.address,
        companyInfo.phone,
        companyInfo.email,
    ];

    // 基準サイズでテキストブロック高さを算出
    let fs = fontSize;
    let namefs = fs * 2;
    let lh = fs * 1.5;
    let nameLh = namefs * 1.3;
    let totalTextH = nameLh + (lines.length - 1) * lh;

    // 枠の高さに収まらない場合、全体を縮小
    const availH = h - margin * 2;
    if (totalTextH > availH) {
        const scale = availH / totalTextH;
        fs = fontSize * scale;
        namefs = fs * 2;
        lh = fs * 1.5;
        nameLh = namefs * 1.3;
        totalTextH = nameLh + (lines.length - 1) * lh;
    }
    const scaledGap = fs * 2;

    // 2. ロゴ挿入（高さをテキストブロックに合わせる）
    let logoRightEdge = x0 + margin + logoOffsetX;
    if (logoBytes) {
        const logoImage = await pdfDoc.embedPng(logoBytes);
        const logoDims = logoImage.scale(1);

        const logoAreaX = x0 + margin + logoOffsetX;
        const logoAreaW = w * logoRatio - margin;

        const targetH = totalTextH;
        const scaleF = Math.min(logoAreaW / logoDims.width, targetH / logoDims.height);
        const drawW = logoDims.width * scaleF;
        const drawH = logoDims.height * scaleF;

        const drawX = logoAreaX;
        const drawY = y0 + (h - drawH) / 2;

        page.drawImage(logoImage, {
            x: drawX, y: drawY, width: drawW, height: drawH,
        });

        logoRightEdge = drawX + drawW;
    }

    // 3. テキスト挿入
    if (showText && fontBytes) {
        const font = await pdfDoc.embedFont(fontBytes);

        const textX = logoRightEdge + scaledGap;
        const textAreaW = x1 - margin - textX;

        const blockTopY = y0 + (h + totalTextH) / 2;

        // 会社名（1行目）
        const nameY = blockTopY - namefs;
        page.drawText(lines[0], {
            x: textX, y: nameY,
            size: namefs, font, color: nameColor,
            maxWidth: textAreaW,
        });

        // 残りの行
        const restStartY = nameY - nameLh + namefs - fs;
        for (let i = 1; i < lines.length; i++) {
            const lineY = restStartY - (i - 1) * lh;
            if (lineY < y0 + margin) break;

            page.drawText(lines[i], {
                x: textX, y: lineY,
                size: fs, font, color: rgb(0, 0, 0),
                maxWidth: textAreaW,
            });
        }
    }

    return await pdfDoc.save();
}
