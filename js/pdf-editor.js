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
    const gap = 3;
    const logoRatio = Math.max(0.1, Math.min(0.9, logoSizePercent / 100));

    // 1. 白塗り
    page.drawRectangle({
        x: x0, y: y0, width: w, height: h,
        color: rgb(1, 1, 1),
        borderColor: rgb(1, 1, 1),
        borderWidth: 0,
    });

    // 2. ロゴ挿入
    let logoRightEdge = x0 + margin + logoOffsetX; // テキスト開始位置のフォールバック
    if (logoBytes) {
        const logoImage = await pdfDoc.embedPng(logoBytes);
        const logoDims = logoImage.scale(1);

        const logoAreaX = x0 + margin + logoOffsetX;
        const logoAreaY = y0 + margin;
        const logoAreaW = w * logoRatio - margin;
        const logoAreaH = h - margin * 2;

        // アスペクト比を維持してフィット
        const scaleF = Math.min(logoAreaW / logoDims.width, logoAreaH / logoDims.height);
        const drawW = logoDims.width * scaleF;
        const drawH = logoDims.height * scaleF;

        // ロゴを左寄せ・縦中央
        const drawX = logoAreaX;
        const drawY = logoAreaY + (logoAreaH - drawH) / 2;

        page.drawImage(logoImage, {
            x: drawX, y: drawY, width: drawW, height: drawH,
        });

        logoRightEdge = drawX + drawW;
    }

    // 3. テキスト挿入（ロゴの実際の右端から gap 分だけ空けて配置）
    if (showText && fontBytes) {
        const font = await pdfDoc.embedFont(fontBytes);

        const textX = logoRightEdge + gap;
        const textAreaW = x1 - margin - textX;
        const lineHeight = fontSize * 1.5;

        const lines = [
            companyInfo.name,
            companyInfo.address,
            companyInfo.phone,
            companyInfo.email,
        ];

        // テキストエリアの上端から描画（pdf-lib の y は bottom-left）
        const textTopY = y1 - margin - fontSize;

        for (let i = 0; i < lines.length; i++) {
            const lineY = textTopY - i * lineHeight;
            if (lineY < y0 + margin) break; // エリア外なら停止

            page.drawText(lines[i], {
                x: textX,
                y: lineY,
                size: fontSize,
                font: font,
                color: rgb(0, 0, 0),
                maxWidth: textAreaW,
            });
        }
    }

    return await pdfDoc.save();
}
