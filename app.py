#!/usr/bin/env python3
"""PDF会社ロゴ差し替え Webアプリ"""

import os
import uuid
from pathlib import Path
from flask import Flask, request, jsonify, send_file, render_template
import fitz  # PyMuPDF

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
LOGO_PATH = BASE_DIR / "logo.png"

UPLOAD_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB

# 固定の会社情報
COMPANY_INFO = {
    "name": "AR株式会社",
    "address": "〒106-0032 東京都港区六本木6丁目1-20 7F",
    "phone": "TEL: 03-6890-2022",
    "email": "MAIL: m.asaka@asaka-real.com",
}


@app.route("/")
def index():
    return render_template("index.html", company=COMPANY_INFO)


@app.route("/upload", methods=["POST"])
def upload_pdf():
    """PDFアップロード → セッションIDとページ数を返す"""
    if "file" not in request.files:
        return jsonify({"error": "ファイルが選択されていません"}), 400

    f = request.files["file"]
    if not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "PDFファイルを選択してください"}), 400

    session_id = str(uuid.uuid4())
    session_dir = UPLOAD_DIR / session_id
    session_dir.mkdir(parents=True)

    pdf_path = session_dir / "original.pdf"
    f.save(str(pdf_path))

    doc = fitz.open(str(pdf_path))
    page_count = doc.page_count
    doc.close()

    return jsonify({"session_id": session_id, "page_count": page_count})


@app.route("/preview/<session_id>/<int:page>")
def preview_page(session_id, page):
    """ページをPNG画像としてレンダリング"""
    pdf_path = UPLOAD_DIR / session_id / "original.pdf"
    if not pdf_path.exists():
        return jsonify({"error": "セッションが見つかりません"}), 404

    zoom = float(request.args.get("zoom", 1.5))
    doc = fitz.open(str(pdf_path))
    if page < 0 or page >= doc.page_count:
        doc.close()
        return jsonify({"error": "ページ番号が無効です"}), 400

    p = doc[page]
    mat = fitz.Matrix(zoom, zoom)
    pix = p.get_pixmap(matrix=mat)
    img_path = UPLOAD_DIR / session_id / f"preview_{page}.png"
    pix.save(str(img_path))

    # ページサイズも返すためヘッダーに含める
    resp = send_file(str(img_path), mimetype="image/png")
    resp.headers["X-Page-Width"] = str(p.rect.width)
    resp.headers["X-Page-Height"] = str(p.rect.height)
    doc.close()
    return resp


def _do_replace(session_id, page_num, rect, font_size, logo_size, logo_offset_x, show_text):
    """共通の差し替え処理。1つの範囲にロゴ+テキストを一括配置する。"""
    pdf_path = UPLOAD_DIR / session_id / "original.pdf"
    if not pdf_path.exists():
        return None, "セッションが見つかりません"

    doc = fitz.open(str(pdf_path))
    page = doc[page_num]
    pdf_rect = fitz.Rect(rect["x0"], rect["y0"], rect["x1"], rect["y1"])

    # 1. 白塗り
    shape = page.new_shape()
    shape.draw_rect(pdf_rect)
    shape.finish(color=(1, 1, 1), fill=(1, 1, 1))
    shape.commit()

    # 2. レイアウト計算
    logo_ratio = max(0.1, min(0.9, logo_size / 100.0))
    gap = 4
    margin = 2

    logo_rect = fitz.Rect(
        pdf_rect.x0 + margin + logo_offset_x,
        pdf_rect.y0 + margin,
        pdf_rect.x0 + pdf_rect.width * logo_ratio - gap + logo_offset_x,
        pdf_rect.y1 - margin,
    )

    # 3. ロゴ挿入
    if LOGO_PATH.exists():
        page.insert_image(logo_rect, filename=str(LOGO_PATH), keep_proportion=True)

    # 4. テキスト挿入（オプション）
    if show_text:
        text_rect = fitz.Rect(
            pdf_rect.x0 + pdf_rect.width * logo_ratio + gap + logo_offset_x,
            pdf_rect.y0 + margin,
            pdf_rect.x1 - margin,
            pdf_rect.y1 - margin,
        )

        text = "\n".join([
            COMPANY_INFO["name"],
            COMPANY_INFO["address"],
            COMPANY_INFO["phone"],
            COMPANY_INFO["email"],
        ])

        font_path = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
        if os.path.exists(font_path):
            page.insert_textbox(
                text_rect, text,
                fontfile=font_path, fontname="hiragino",
                fontsize=font_size,
                align=fitz.TEXT_ALIGN_LEFT,
            )
        else:
            page.insert_textbox(
                text_rect, text,
                fontname="japan", fontsize=font_size,
                align=fitz.TEXT_ALIGN_LEFT,
            )

    # 5. 保存
    output_path = UPLOAD_DIR / session_id / "edited.pdf"
    doc.save(str(output_path), garbage=4, deflate=True)
    doc.close()

    return output_path, None


def _parse_replace_params(data):
    """リクエストJSONから差し替えパラメータを取り出す。"""
    return (
        data.get("session_id"),
        data.get("page", 0),
        data.get("rect"),
        data.get("font_size", 8),
        data.get("logo_size", 30),
        data.get("logo_offset_x", 0),
        data.get("show_text", True),
    )


@app.route("/replace-preview", methods=["POST"])
def replace_preview():
    """差し替えを実行し、結果をPNG画像でプレビュー返却"""
    data = request.json
    session_id, page_num, rect, font_size, logo_size, logo_offset_x, show_text = _parse_replace_params(data)

    if not session_id or not rect:
        return jsonify({"error": "パラメータが不足しています"}), 400

    output_path, err = _do_replace(session_id, page_num, rect, font_size, logo_size, logo_offset_x, show_text)
    if err:
        return jsonify({"error": err}), 404

    zoom = float(request.args.get("zoom", 1.5))
    doc = fitz.open(str(output_path))
    p = doc[page_num]
    mat = fitz.Matrix(zoom, zoom)
    pix = p.get_pixmap(matrix=mat)
    img_path = UPLOAD_DIR / session_id / "edited_preview.png"
    pix.save(str(img_path))
    doc.close()

    return send_file(str(img_path), mimetype="image/png")


@app.route("/replace", methods=["POST"])
def replace_area():
    """指定範囲を差し替えて新PDFを返す"""
    data = request.json
    session_id, page_num, rect, font_size, logo_size, logo_offset_x, show_text = _parse_replace_params(data)

    if not session_id or not rect:
        return jsonify({"error": "パラメータが不足しています"}), 400

    output_path, err = _do_replace(session_id, page_num, rect, font_size, logo_size, logo_offset_x, show_text)
    if err:
        return jsonify({"error": err}), 404

    return send_file(
        str(output_path),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"edited_{session_id[:8]}.pdf",
    )


@app.route("/download/<session_id>")
def download_edited(session_id):
    """編集済みPDFをダウンロード"""
    output_path = UPLOAD_DIR / session_id / "edited.pdf"
    if not output_path.exists():
        return jsonify({"error": "編集済みファイルが見つかりません"}), 404

    return send_file(
        str(output_path),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"edited_{session_id[:8]}.pdf",
    )


if __name__ == "__main__":
    app.run(debug=True, port=5001, use_reloader=False)
