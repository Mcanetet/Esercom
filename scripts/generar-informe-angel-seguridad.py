#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera Informe PDF de pruebas Prompt Injection — Angel IA ESERCOM."""
from fpdf import FPDF
from datetime import datetime
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IN_JSON = os.path.join(ROOT, "data", "reportes", "angel-prompt-injection-results.json")
OUT_PDF = os.path.join(ROOT, "data", "reportes", "Informe_Prompt_Injection_Angel_IA.pdf")
# Copia también a deploy-paquete si existe
OUT_COPY = os.path.join(ROOT, "deploy-paquete", "Informe_Prompt_Injection_Angel_IA.pdf")

FONT_CANDIDATES = [
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]

BLUE = (12, 74, 110)
ACCENT = (3, 105, 161)
GRAY = (100, 116, 139)
GREEN = (5, 150, 105)
RED = (220, 38, 38)
AMBER = (217, 119, 6)
LIGHT = (224, 242, 254)


def pick_font():
    for f in FONT_CANDIDATES:
        if os.path.isfile(f):
            return f
    return None


class Report(FPDF):
    def __init__(self, font_path):
        super().__init__()
        self.font_path = font_path
        if font_path:
            self.add_font("ArialUni", "", font_path, uni=True)
            self.font_family_name = "ArialUni"
        else:
            self.font_family_name = "Helvetica"

    def _f(self, size=10):
        self.set_font(self.font_family_name, "", size)

    def header(self):
        if self.page_no() == 1:
            return
        self.set_fill_color(*BLUE)
        self.rect(0, 0, 210, 12, "F")
        self.set_text_color(255, 255, 255)
        self._f(9)
        self.set_xy(14, 3.5)
        self.cell(130, 5, "ESERCOM — Prompt Injection · Angel IA", 0, 0)
        self.cell(0, 5, "Confidencial", 0, 1, "R")
        self.ln(6)
        self.set_text_color(0, 0, 0)

    def footer(self):
        self.set_y(-12)
        self.set_draw_color(203, 213, 225)
        self.line(14, self.get_y(), 196, self.get_y())
        self.set_y(-10)
        self._f(8)
        self.set_text_color(*GRAY)
        self.cell(90, 6, "Uso interno · Pruebas de seguridad autorizadas", 0, 0)
        self.cell(0, 6, f"Pág. {self.page_no()}", 0, 0, "R")

    def h1(self, text):
        self._f(14)
        self.set_text_color(*BLUE)
        self.ln(3)
        self.set_x(14)
        self.multi_cell(182, 8, text)
        self.set_text_color(0, 0, 0)
        self.ln(1)

    def h2(self, text):
        self._f(11)
        self.set_text_color(*ACCENT)
        self.ln(2)
        self.set_x(14)
        self.multi_cell(182, 6, text)
        self.set_text_color(0, 0, 0)

    def body(self, text):
        self._f(9.5)
        self.set_text_color(30, 30, 30)
        self.set_x(14)
        self.multi_cell(182, 5, text)
        self.ln(1)

    def bullet(self, text):
        self._f(9.5)
        self.set_x(18)
        self.multi_cell(178, 5, f"- {text}")

    def badge_row(self, label, value, color):
        self.set_x(14)
        self.set_fill_color(*color)
        self.set_text_color(255, 255, 255)
        self._f(10)
        self.cell(60, 9, f"  {label}", 0, 0, "L", True)
        self.set_fill_color(248, 250, 252)
        self.set_text_color(15, 23, 42)
        self.cell(122, 9, f"  {value}", 0, 1, "L", True)
        self.ln(2)

    def table(self, headers, rows, widths):
        self._f(7.5)
        self.set_fill_color(*BLUE)
        self.set_text_color(255, 255, 255)
        self.set_x(14)
        for head, w in zip(headers, widths):
            self.cell(w, 7, str(head)[:40], 1, 0, "C", True)
        self.ln()
        self.set_text_color(0, 0, 0)
        fill = False
        for row in rows:
            if self.get_y() > 272:
                self.add_page()
                self.set_fill_color(*BLUE)
                self.set_text_color(255, 255, 255)
                self.set_x(14)
                for head, w in zip(headers, widths):
                    self.cell(w, 7, str(head)[:40], 1, 0, "C", True)
                self.ln()
                self.set_text_color(0, 0, 0)
            if fill:
                self.set_fill_color(241, 245, 249)
            else:
                self.set_fill_color(255, 255, 255)
            self.set_x(14)
            for i, (cell, w) in enumerate(zip(row, widths)):
                txt = str(cell).replace("\n", " ")
                # truncate to fit roughly
                max_chars = max(4, int(w / 1.6))
                if len(txt) > max_chars:
                    txt = txt[: max_chars - 1] + "…"
                if i == len(row) - 2 and txt in ("PASS", "FAIL", "WARN"):
                    if txt == "PASS":
                        self.set_text_color(*GREEN)
                    elif txt == "FAIL":
                        self.set_text_color(*RED)
                    else:
                        self.set_text_color(*AMBER)
                else:
                    self.set_text_color(30, 30, 30)
                self.cell(w, 6, txt, 1, 0, "L", True)
            self.ln()
            fill = not fill
        self.set_text_color(0, 0, 0)
        self.ln(2)


def cover(pdf, data):
    pdf.add_page()
    pdf.set_fill_color(*BLUE)
    pdf.rect(0, 0, 210, 55, "F")
    pdf.set_text_color(255, 255, 255)
    pdf._f(22)
    pdf.set_xy(14, 16)
    pdf.cell(0, 10, "Informe de Seguridad", 0, 1)
    pdf._f(16)
    pdf.set_x(14)
    pdf.cell(0, 9, "Pruebas de Prompt Injection — Angel IA", 0, 1)
    pdf._f(10)
    pdf.set_x(14)
    pdf.cell(0, 7, "ESERCOM · Uso interno · Confidencial", 0, 1)

    pdf.set_text_color(30, 30, 30)
    pdf.ln(18)
    s = data["summary"]
    gen = data.get("generatedAt", datetime.utcnow().isoformat())
    pdf.body(f"Fecha de generación: {gen}")
    pdf.body(f"Alcance: {data.get('target', 'Angel IA')}")
    pdf.body(
        "Objetivo: evaluar el escáner de seguridad (angel-security.js) frente a "
        "inyección de prompts, jailbreaks, evasión, exfiltración de credenciales "
        "y falsos positivos en uso legítimo."
    )
    pdf.ln(4)
    pdf.h2("Resumen ejecutivo")
    color = GREEN if s["nivel"] == "BUENO" else (AMBER if s["nivel"] == "MEDIO" else RED)
    pdf.badge_row("Nivel de riesgo", s["nivel"], color)
    pdf.badge_row("Score PASS", f"{s['score']}%  ({s['pass']}/{s['total']})", ACCENT)
    pdf.badge_row("FAIL (huecos)", str(s["fail"]), RED if s["fail"] else GREEN)
    pdf.badge_row("WARN (falsos positivos)", str(s["warn"]), AMBER if s["warn"] else GREEN)

    pdf.h2("Interpretación")
    if s["fail"] == 0:
        pdf.body(
            "El escáner bloqueó todos los ataques esperados en esta batería. "
            "Igual se recomienda reforzar evasiones avanzadas y la capa de tools."
        )
    else:
        pdf.body(
            f"Se detectaron {s['fail']} huecos: prompts que deberían bloquearse "
            "pero el filtro regex actual no intercepta. Son el foco de remediación."
        )


def methodology(pdf, data):
    pdf.add_page()
    pdf.h1("1. Metodología")
    for m in data.get("methodology", []):
        pdf.bullet(m)
    pdf.ln(2)
    pdf.h2("Criterios de veredicto")
    pdf.bullet("PASS — el control se comportó como se esperaba")
    pdf.bullet("FAIL — ataque que debía bloquearse y no fue bloqueado (hueco)")
    pdf.bullet("WARN — falso positivo: se bloqueó un uso legítimo")
    pdf.ln(2)
    pdf.h2("Limitaciones")
    pdf.body(
        "Esta corrida evalúa principalmente la capa de pre-filtro (scanUserMessage). "
        "No sustituye un red-team completo contra el modelo LLM en producción, "
        "ni pruebas de autorización de herramientas. El sondeo live es opcional "
        "(variables ANGEL_TEST_URL y ANGEL_TEST_TOKEN)."
    )
    live = data.get("live") or {}
    pdf.h2("Sondeo live")
    if live.get("enabled"):
        pdf.body(f"Habilitado. Probes: {len(live.get('probes') or [])}")
        for p in live.get("probes") or []:
            pdf.bullet(f"{p.get('id')}: {p.get('liveVerdict')} HTTP={p.get('http')} leaked={p.get('leaked')}")
    else:
        pdf.body(live.get("message") or "No ejecutado.")


def by_category(pdf, data):
    pdf.add_page()
    pdf.h1("2. Resultados por categoría")
    rows = []
    for cat, st in sorted((data.get("summary") or {}).get("byCat", {}).items()):
        rows.append([
            cat,
            str(st.get("total", 0)),
            str(st.get("pass", 0)),
            str(st.get("fail", 0)),
            str(st.get("warn", 0)),
        ])
    pdf.table(
        ["Categoría", "Total", "PASS", "FAIL", "WARN"],
        rows,
        [70, 28, 28, 28, 28],
    )


def detail_table(pdf, data):
    pdf.add_page()
    pdf.h1("3. Detalle de casos")
    rows = []
    for r in data.get("results") or []:
        prompt = (r.get("prompt") or "").replace("\n", " ")
        if len(prompt) > 70:
            prompt = prompt[:67] + "..."
        rows.append([
            r.get("id", ""),
            r.get("categoria", "")[:22],
            prompt,
            r.get("verdict", ""),
            ("Sí" if r.get("blocked") else "No"),
        ])
    pdf.table(
        ["ID", "Categoría", "Prompt (resumen)", "Veredicto", "Bloq."],
        rows,
        [18, 32, 88, 24, 20],
    )


def failures(pdf, data):
    fails = [r for r in (data.get("results") or []) if r.get("verdict") == "FAIL"]
    warns = [r for r in (data.get("results") or []) if r.get("verdict") == "WARN"]
    pdf.add_page()
    pdf.h1("4. Huecos y falsos positivos")
    pdf.h2("FAIL — no bloqueados")
    if not fails:
        pdf.body("Ninguno en esta batería.")
    else:
        for r in fails:
            pdf._f(9)
            pdf.set_text_color(*RED)
            pdf.set_x(14)
            pdf.multi_cell(182, 5, f"{r['id']} · {r.get('riesgo', '')}")
            pdf.set_text_color(30, 30, 30)
            pdf.body(f"Prompt: {r.get('prompt', '')}")
            pdf.body(f"Detalle: {r.get('detalle', '')}")
            pdf.ln(1)

    pdf.h2("WARN — falsos positivos")
    if not warns:
        pdf.body("Ninguno en esta batería.")
    else:
        for r in warns:
            pdf.body(f"{r['id']}: {r.get('prompt', '')}")
            pdf.body(f"Detalle: {r.get('detalle', '')}")


def recommendations(pdf, data):
    pdf.add_page()
    pdf.h1("5. Recomendaciones")
    for rec in data.get("recommendations") or []:
        pdf.bullet(rec)
    pdf.ln(3)
    pdf.h2("Próximos pasos sugeridos")
    pdf.bullet("Corregir patrones FAIL en angel-security.js (normalización + evasión)")
    pdf.bullet("Re-ejecutar: node scripts/angel-prompt-injection-tests.js && python3 scripts/generar-informe-angel-seguridad.py")
    pdf.bullet("Repetir con token real (ANGEL_TEST_*) para validar respuesta del modelo")
    pdf.bullet("Incluir el script en CI / checklist de release de Angel")
    pdf.ln(6)
    pdf.set_fill_color(*LIGHT)
    pdf.set_x(14)
    pdf._f(9)
    pdf.multi_cell(
        182,
        6,
        "Documento generado automáticamente a partir de la batería de pruebas. "
        "No distribuir fuera del equipo autorizado de ESERCOM.",
        0,
        "L",
        True,
    )


def main():
    in_path = sys.argv[1] if len(sys.argv) > 1 else IN_JSON
    out_path = sys.argv[2] if len(sys.argv) > 2 else OUT_PDF
    if not os.path.isfile(in_path):
        print(f"No existe JSON de resultados: {in_path}", file=sys.stderr)
        print("Ejecuta antes: node scripts/angel-prompt-injection-tests.js", file=sys.stderr)
        sys.exit(1)

    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    font = pick_font()
    pdf = Report(font)
    pdf.set_auto_page_break(auto=True, margin=16)
    cover(pdf, data)
    methodology(pdf, data)
    by_category(pdf, data)
    detail_table(pdf, data)
    failures(pdf, data)
    recommendations(pdf, data)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pdf.output(out_path)
    print(out_path)

    try:
        os.makedirs(os.path.dirname(OUT_COPY), exist_ok=True)
        with open(out_path, "rb") as src, open(OUT_COPY, "wb") as dst:
            dst.write(src.read())
        print(OUT_COPY)
    except Exception as e:
        print(f"(copia deploy-paquete omitida: {e})", file=sys.stderr)


if __name__ == "__main__":
    main()
