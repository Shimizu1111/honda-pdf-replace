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

    // テキスト情報を先に計算（ロゴの高さをテキスト全体の高さに合わせるため）
    const nameColor = rgb(0x16 / 255, 0x4b / 255, 0x7d / 255);
    const nameFontSize = fontSize * 2;
    const lineHeight = fontSize * 1.5;
    const nameLineHeight = nameFontSize * 1.3;
    const lines = [
        companyInfo.name,
        companyInfo.address,
        companyInfo.phone,
        companyInfo.email,
    ];
    // テキストブロック全体の高さ: 会社名行 + 残り行
    const totalTextH = nameLineHeight + (lines.length - 1) * lineHeight;

    // 2. ロゴ挿入（高さをテキストブロックに合わせる）
    let logoRightEdge = x0 + margin + logoOffsetX;
    if (logoBytes) {
        const logoImage = await pdfDoc.embedPng(logoBytes);
        const logoDims = logoImage.scale(1);

        const logoAreaX = x0 + margin + logoOffsetX;
        const logoAreaW = w * logoRatio - margin;

        // ロゴの高さをテキストブロックの高さに合わせる
        const targetH = totalTextH;
        const scaleF = Math.min(logoAreaW / logoDims.width, targetH / logoDims.height);
        const drawW = logoDims.width * scaleF;
        const drawH = logoDims.height * scaleF;

        // 選択範囲の縦中央に配置
        const drawX = logoAreaX;
        const drawY = y0 + (h - drawH) / 2;

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

        // テキストブロックを縦中央に配置
        const blockTopY = y0 + (h + totalTextH) / 2;

        // 会社名（1行目）
        const nameY = blockTopY - nameFontSize;
        page.drawText(lines[0], {
            x: textX, y: nameY,
            size: nameFontSize, font, color: nameColor,
            maxWidth: textAreaW,
        });

        // 残りの行（住所・TEL・MAIL）
        const restStartY = nameY - nameLineHeight + nameFontSize - fontSize;
        for (let i = 1; i < lines.length; i++) {
            const lineY = restStartY - (i - 1) * lineHeight;
            if (lineY < y0 + margin) break;

            page.drawText(lines[i], {
                x: textX, y: lineY,
                size: fontSize, font, color: rgb(0, 0, 0),
                maxWidth: textAreaW,
            });
        }
    }

    return await pdfDoc.save();
}
