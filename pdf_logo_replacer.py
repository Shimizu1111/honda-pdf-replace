#!/usr/bin/env python3
"""PDF会社ロゴ・情報差し替えツール

PDFを開いてプレビューし、マウスで範囲を選択して
会社ロゴと情報を差し替えて保存するGUIツール。
"""

import json
import os
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from dataclasses import dataclass, field, asdict
from pathlib import Path
from PIL import Image, ImageTk
import fitz  # PyMuPDF

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "config.json"


@dataclass
class Config:
    logo_path: str = ""
    company_name: str = ""
    company_lines: list = field(default_factory=list)  # 追加テキスト行（住所、電話等）
    font_size: float = 9.0

    def save(self):
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(asdict(self), f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls):
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
            except Exception:
                pass
        return cls()


class PdfDocument:
    def __init__(self):
        self.doc = None
        self.path = None

    def open(self, path):
        self.doc = fitz.open(path)
        self.path = path

    @property
    def page_count(self):
        return self.doc.page_count if self.doc else 0

    def render_page(self, page_num, zoom=1.5):
        """ページをPIL Imageとして描画"""
        page = self.doc[page_num]
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return img

    def get_page_size(self, page_num):
        """ページのPDFポイントサイズを返す"""
        page = self.doc[page_num]
        return page.rect.width, page.rect.height

    def replace_area(self, page_num, rect, logo_path, texts, font_size):
        """指定範囲を白塗りし、ロゴとテキストを配置"""
        page = self.doc[page_num]

        # 1. 白塗り
        shape = page.new_shape()
        shape.draw_rect(rect)
        shape.finish(color=(1, 1, 1), fill=(1, 1, 1))
        shape.commit()

        has_logo = logo_path and os.path.exists(logo_path)
        has_text = any(t.strip() for t in texts)

        if has_logo and has_text:
            # ロゴ左40%、テキスト右60%
            gap = 5
            logo_rect = fitz.Rect(
                rect.x0, rect.y0,
                rect.x0 + rect.width * 0.35 - gap, rect.y1
            )
            text_rect = fitz.Rect(
                rect.x0 + rect.width * 0.35 + gap, rect.y0,
                rect.x1, rect.y1
            )
        elif has_logo:
            logo_rect = rect
            text_rect = None
        else:
            logo_rect = None
            text_rect = rect

        # 2. ロゴ挿入
        if has_logo and logo_rect:
            page.insert_image(logo_rect, filename=logo_path, keep_proportion=True)

        # 3. テキスト挿入
        if has_text and text_rect:
            # 日本語フォント（ヒラギノ角ゴシック）を使用
            font_path = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
            if not os.path.exists(font_path):
                # フォールバック
                font_path = None

            text = "\n".join(t for t in texts if t.strip())

            if font_path:
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

    def save(self, output_path):
        self.doc.save(output_path, garbage=4, deflate=True)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PDF ロゴ差し替えツール")
        self.geometry("1000x850")

        self.config_data = Config.load()
        self.pdf = PdfDocument()
        self.current_page = 0
        self.zoom = 1.5
        self.preview_image = None
        self.photo_image = None

        # 範囲選択用
        self.selecting = False
        self.sel_start = None
        self.sel_rect_id = None
        self.selection = None  # (x1, y1, x2, y2) in canvas coords

        self._build_ui()
        self._load_config_to_ui()

    def _build_ui(self):
        # --- ツールバー ---
        toolbar = ttk.Frame(self)
        toolbar.pack(fill=tk.X, padx=5, pady=3)

        ttk.Button(toolbar, text="PDF を開く", command=self.open_pdf).pack(side=tk.LEFT)
        ttk.Button(toolbar, text="◀", command=self.prev_page, width=3).pack(side=tk.LEFT, padx=(10, 0))
        self.page_label = ttk.Label(toolbar, text="- / -")
        self.page_label.pack(side=tk.LEFT, padx=5)
        ttk.Button(toolbar, text="▶", command=self.next_page, width=3).pack(side=tk.LEFT)
        ttk.Button(toolbar, text="選択クリア", command=self.clear_selection).pack(side=tk.LEFT, padx=(15, 0))

        # --- プレビューエリア（スクロール対応） ---
        preview_frame = ttk.Frame(self)
        preview_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=3)

        self.canvas = tk.Canvas(preview_frame, bg="#e0e0e0", cursor="crosshair")
        vscroll = ttk.Scrollbar(preview_frame, orient=tk.VERTICAL, command=self.canvas.yview)
        hscroll = ttk.Scrollbar(preview_frame, orient=tk.HORIZONTAL, command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vscroll.set, xscrollcommand=hscroll.set)

        self.canvas.grid(row=0, column=0, sticky="nsew")
        vscroll.grid(row=0, column=1, sticky="ns")
        hscroll.grid(row=1, column=0, sticky="ew")
        preview_frame.rowconfigure(0, weight=1)
        preview_frame.columnconfigure(0, weight=1)

        # マウスイベント
        self.canvas.bind("<ButtonPress-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)

        # --- 設定パネル ---
        settings = ttk.LabelFrame(self, text="差し替え内容")
        settings.pack(fill=tk.X, padx=5, pady=3)

        # ロゴ
        row0 = ttk.Frame(settings)
        row0.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(row0, text="ロゴ画像:").pack(side=tk.LEFT)
        self.logo_var = tk.StringVar()
        ttk.Entry(row0, textvariable=self.logo_var, width=50).pack(side=tk.LEFT, padx=5)
        ttk.Button(row0, text="参照", command=self.browse_logo).pack(side=tk.LEFT)

        # 会社名
        row1 = ttk.Frame(settings)
        row1.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(row1, text="会社名:").pack(side=tk.LEFT)
        self.company_var = tk.StringVar()
        ttk.Entry(row1, textvariable=self.company_var, width=50).pack(side=tk.LEFT, padx=5)

        # 追加行（住所・電話等）
        row2 = ttk.Frame(settings)
        row2.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(row2, text="追加情報:").pack(side=tk.LEFT, anchor=tk.N)
        self.lines_text = tk.Text(row2, height=3, width=50)
        self.lines_text.pack(side=tk.LEFT, padx=5)
        ttk.Label(row2, text="(1行ずつ: 住所、TEL等)").pack(side=tk.LEFT)

        # フォントサイズ
        row3 = ttk.Frame(settings)
        row3.pack(fill=tk.X, padx=5, pady=2)
        ttk.Label(row3, text="フォントサイズ:").pack(side=tk.LEFT)
        self.fontsize_var = tk.StringVar(value="9")
        ttk.Spinbox(row3, from_=6, to=20, textvariable=self.fontsize_var, width=5).pack(side=tk.LEFT, padx=5)

        # 実行ボタン
        btn_frame = ttk.Frame(settings)
        btn_frame.pack(fill=tk.X, padx=5, pady=5)
        ttk.Button(btn_frame, text="差し替えて保存", command=self.apply_and_save).pack(side=tk.LEFT)
        ttk.Button(btn_frame, text="設定を保存", command=self.save_config).pack(side=tk.LEFT, padx=10)

        # --- ステータスバー ---
        self.status_var = tk.StringVar(value="PDFを開いてください")
        ttk.Label(self, textvariable=self.status_var, relief=tk.SUNKEN, anchor=tk.W).pack(
            fill=tk.X, padx=5, pady=2
        )

    def _load_config_to_ui(self):
        self.logo_var.set(self.config_data.logo_path)
        self.company_var.set(self.config_data.company_name)
        self.lines_text.delete("1.0", tk.END)
        self.lines_text.insert("1.0", "\n".join(self.config_data.company_lines))
        self.fontsize_var.set(str(self.config_data.font_size))

    def _gather_config(self):
        self.config_data.logo_path = self.logo_var.get().strip()
        self.config_data.company_name = self.company_var.get().strip()
        lines_raw = self.lines_text.get("1.0", tk.END).strip()
        self.config_data.company_lines = [l for l in lines_raw.split("\n") if l.strip()]
        try:
            self.config_data.font_size = float(self.fontsize_var.get())
        except ValueError:
            self.config_data.font_size = 9.0

    def save_config(self):
        self._gather_config()
        self.config_data.save()
        self.status_var.set("設定を保存しました")

    # --- PDF操作 ---

    def open_pdf(self):
        path = filedialog.askopenfilename(
            title="PDFファイルを選択",
            filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")]
        )
        if not path:
            return
        try:
            self.pdf.open(path)
            self.current_page = 0
            self.clear_selection()
            self._render_current_page()
            self.status_var.set(f"読み込み: {os.path.basename(path)} ({self.pdf.page_count}ページ)")
        except Exception as e:
            messagebox.showerror("エラー", f"PDFを開けませんでした:\n{e}")

    def prev_page(self):
        if self.pdf.doc and self.current_page > 0:
            self.current_page -= 1
            self.clear_selection()
            self._render_current_page()

    def next_page(self):
        if self.pdf.doc and self.current_page < self.pdf.page_count - 1:
            self.current_page += 1
            self.clear_selection()
            self._render_current_page()

    def _render_current_page(self):
        if not self.pdf.doc:
            return
        self.preview_image = self.pdf.render_page(self.current_page, self.zoom)
        self.photo_image = ImageTk.PhotoImage(self.preview_image)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self.photo_image)
        self.canvas.configure(scrollregion=(0, 0, self.preview_image.width, self.preview_image.height))
        self.page_label.config(text=f"{self.current_page + 1} / {self.pdf.page_count}")
        self.sel_rect_id = None
        self.selection = None

    # --- 範囲選択 ---

    def _canvas_coords(self, event):
        """スクロール位置を考慮したキャンバス座標を返す"""
        x = self.canvas.canvasx(event.x)
        y = self.canvas.canvasy(event.y)
        return x, y

    def _on_press(self, event):
        if not self.pdf.doc:
            return
        self.selecting = True
        self.sel_start = self._canvas_coords(event)
        if self.sel_rect_id:
            self.canvas.delete(self.sel_rect_id)
            self.sel_rect_id = None

    def _on_drag(self, event):
        if not self.selecting:
            return
        x, y = self._canvas_coords(event)
        x0, y0 = self.sel_start
        if self.sel_rect_id:
            self.canvas.coords(self.sel_rect_id, x0, y0, x, y)
        else:
            self.sel_rect_id = self.canvas.create_rectangle(
                x0, y0, x, y,
                outline="red", width=2, dash=(5, 3)
            )

    def _on_release(self, event):
        if not self.selecting:
            return
        self.selecting = False
        x, y = self._canvas_coords(event)
        x0, y0 = self.sel_start
        # 正規化（左上→右下）
        self.selection = (min(x0, x), min(y0, y), max(x0, x), max(y0, y))
        # PDF座標に変換した情報をステータスバーに表示
        pdf_rect = self._selection_to_pdf_rect()
        if pdf_rect:
            self.status_var.set(
                f"選択範囲 (PDF座標): x={pdf_rect.x0:.0f}, y={pdf_rect.y0:.0f}, "
                f"w={pdf_rect.width:.0f}, h={pdf_rect.height:.0f}"
            )

    def clear_selection(self):
        if self.sel_rect_id:
            self.canvas.delete(self.sel_rect_id)
            self.sel_rect_id = None
        self.selection = None
        self.selecting = False

    def _selection_to_pdf_rect(self):
        if not self.selection:
            return None
        x0, y0, x1, y1 = self.selection
        return fitz.Rect(x0 / self.zoom, y0 / self.zoom, x1 / self.zoom, y1 / self.zoom)

    # --- ロゴ参照 ---

    def browse_logo(self):
        path = filedialog.askopenfilename(
            title="ロゴ画像を選択",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.gif"), ("All files", "*.*")]
        )
        if path:
            self.logo_var.set(path)

    # --- 差し替え実行 ---

    def apply_and_save(self):
        if not self.pdf.doc:
            messagebox.showwarning("警告", "PDFを開いてください")
            return
        if not self.selection:
            messagebox.showwarning("警告", "差し替え範囲をマウスで選択してください")
            return

        self._gather_config()

        logo_path = self.config_data.logo_path
        company_name = self.config_data.company_name
        lines = self.config_data.company_lines
        font_size = self.config_data.font_size

        if not logo_path and not company_name and not lines:
            messagebox.showwarning("警告", "ロゴまたは会社情報を入力してください")
            return

        texts = []
        if company_name:
            texts.append(company_name)
        texts.extend(lines)

        pdf_rect = self._selection_to_pdf_rect()

        # 保存先を選択
        orig_name = Path(self.pdf.path).stem
        default_name = f"{orig_name}_edited.pdf"
        output_path = filedialog.asksaveasfilename(
            title="保存先を選択",
            initialfile=default_name,
            defaultextension=".pdf",
            filetypes=[("PDF files", "*.pdf")],
        )
        if not output_path:
            return

        try:
            self.pdf.replace_area(
                self.current_page, pdf_rect,
                logo_path, texts, font_size
            )
            self.pdf.save(output_path)
            self.status_var.set(f"保存完了: {os.path.basename(output_path)}")
            messagebox.showinfo("完了", f"保存しました:\n{output_path}")

            # プレビュー更新（保存後のPDFを再読み込み）
            self.pdf.open(output_path)
            self._render_current_page()

        except Exception as e:
            messagebox.showerror("エラー", f"処理に失敗しました:\n{e}")


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
