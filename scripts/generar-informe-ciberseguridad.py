#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera Informe de Ciberseguridad ESERCOM (PDF)."""
from fpdf import FPDF
from datetime import datetime
import os

OUT = "/Users/miguelangel/Downloads/Esercom/deploy-paquete/Informe_Ciberseguridad_ESERCOM.pdf"
FONT = "/Library/Fonts/Arial Unicode.ttf"
BLUE = (12, 74, 110)
ACCENT = (3, 105, 161)
GRAY = (100, 116, 139)
LIGHT = (224, 242, 254)


class Report(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_fill_color(*BLUE)
        self.rect(0, 0, 210, 12, "F")
        self.set_text_color(255, 255, 255)
        self.set_font("ArialUni", "", 9)
        self.set_xy(14, 3.5)
        self.cell(120, 5, "ESERCOM — Informe de Ciberseguridad", 0, 0)
        self.cell(0, 5, "Confidencial", 0, 1, "R")
        self.ln(6)
        self.set_text_color(0, 0, 0)

    def footer(self):
        self.set_y(-12)
        self.set_draw_color(203, 213, 225)
        self.line(14, self.get_y(), 196, self.get_y())
        self.set_y(-10)
        self.set_font("ArialUni", "", 8)
        self.set_text_color(*GRAY)
        self.cell(90, 6, "Uso interno · No distribuir sin autorización", 0, 0)
        self.cell(0, 6, f"Pág. {self.page_no()}", 0, 0, "R")

    def h1(self, text):
        self.set_font("ArialUni", "", 14)
        self.set_text_color(*BLUE)
        self.ln(3)
        self.set_x(14)
        self.multi_cell(182, 8, text)
        self.set_text_color(0, 0, 0)
        self.ln(1)

    def h2(self, text):
        self.set_font("ArialUni", "", 11)
        self.set_text_color(*ACCENT)
        self.ln(2)
        self.set_x(14)
        self.multi_cell(182, 6, text)
        self.set_text_color(0, 0, 0)

    def body(self, text):
        self.set_font("ArialUni", "", 9.5)
        self.set_text_color(30, 30, 30)
        self.set_x(14)
        self.multi_cell(182, 5, text)
        self.ln(1)

    def bullet(self, text):
        self.set_font("ArialUni", "", 9.5)
        self.set_x(18)
        self.multi_cell(178, 5, f"- {text}")

    def table(self, headers, rows, widths):
        self.set_font("ArialUni", "", 8)
        self.set_fill_color(*BLUE)
        self.set_text_color(255, 255, 255)
        self.set_x(14)
        for head, w in zip(headers, widths):
            self.cell(w, 7, head[:40], 1, 0, "C", True)
        self.ln()
        self.set_text_color(0, 0, 0)
        fill = False
        for row in rows:
            if self.get_y() > 265:
                self.add_page()
            self.set_x(14)
            if fill:
                self.set_fill_color(248, 250, 252)
            else:
                self.set_fill_color(255, 255, 255)
            # single-line truncated cells for reliability
            for cell, w in zip(row, widths):
                txt = str(cell).replace("\n", " ")
                # fit approx
                while self.get_string_width(txt) > w - 2 and len(txt) > 3:
                    txt = txt[:-2]
                if txt != str(cell).replace("\n", " "):
                    txt = txt[:-1] + "..."
                self.cell(w, 6, txt, 1, 0, "L", True)
            self.ln()
            fill = not fill
        self.ln(2)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    pdf = Report(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_font("ArialUni", "", FONT)
    pdf.set_margins(14, 16, 14)

    # Cover
    pdf.add_page()
    pdf.ln(35)
    pdf.set_font("ArialUni", "", 22)
    pdf.set_text_color(*BLUE)
    pdf.set_x(14)
    pdf.multi_cell(182, 10, "INFORME DE CIBERSEGURIDAD", align="C")
    pdf.set_font("ArialUni", "", 12)
    pdf.set_text_color(*GRAY)
    pdf.set_x(14)
    pdf.multi_cell(182, 7, "Plataforma ESERCOM - Gestion Integral Empresarial", align="C")
    pdf.ln(4)
    pdf.set_draw_color(*ACCENT)
    pdf.set_line_width(0.6)
    y = pdf.get_y()
    pdf.line(55, y, 155, y)
    pdf.set_y(y + 6)
    pdf.set_x(14)
    pdf.set_font("ArialUni", "", 11)
    pdf.multi_cell(182, 6, "Estado de controles, hallazgos, remediaciones y residual risk", align="C")
    pdf.ln(12)

    pdf.set_fill_color(*LIGHT)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("ArialUni", "", 9)
    meta = [
        ("Fecha del informe", datetime.now().strftime("%d-%m-%Y %H:%M")),
        ("Alcance", "App Node.js ESERCOM (API, auth, Angel IA, módulos, front)"),
        ("Ambiente evaluado", "Código local + producción esercom.cl"),
        ("Clasificación", "Confidencial — Uso interno"),
        ("Versión", "1.0"),
    ]
    for k, v in meta:
        pdf.set_x(25)
        pdf.cell(45, 7, k, 1, 0, "L", True)
        pdf.cell(115, 7, v, 1, 1, "L")

    pdf.ln(10)
    pdf.set_x(14)
    pdf.body(
        "Este documento resume la postura de seguridad de ESERCOM tras la revisión técnica y las remediaciones "
        "aplicadas (julio 2026): autenticación, aislamiento multi-empresa, Angel IA / Cerebro, descargas, uploads, "
        "CORS, XSS y hardening operativo."
    )

    # 1
    pdf.add_page()
    pdf.h1("1. Resumen ejecutivo")
    pdf.body(
        "ESERCOM es una aplicación Node.js multiempresa (Global, Sercom, Nexus, Táctica, Intercanje) con autenticación JWT, "
        "módulos operativos (materiales, flota, agenda, compras, etc.) y el asistente Angel IA con portal de entrenamiento (Cerebro). "
        "Se realizó una revisión orientada a riesgos explotables y se implementaron mitigaciones prioritarias en producción."
    )
    pdf.h2("Veredicto")
    pdf.body(
        "La postura actual es aceptable para operación tras los fixes de autenticación, descargas, XSS, rate limiting y hardening de arranque. "
        "Permanece un riesgo arquitectónico residual en modo MySQL compartido (BD única legado PHP), donde el selector de empresa no aísla filas entre marcas."
    )
    pdf.table(
        ["Tema", "Detalle"],
        [
            ["Críticos / Altos mitigados", "JWT obligatorio, admin estricto, reportes aislados, XSS, rate limit, checklist, agenda"],
            ["Residual alto", "MySQL multi-tenant cosmético (una BD para todas las marcas)"],
            ["Residual medio", "Tokens en localStorage, CORS configurable, Angel train clave compartida"],
            ["Acción inmediata", "Reiniciar Node; verificar JWT_SECRET / ADMIN / ANGEL_TRAIN passwords"],
        ],
        [45, 137],
    )

    pdf.h1("2. Alcance de la revisión")
    for b in [
        "Autenticación y sesión (login, JWT, portales admin y Angel train).",
        "Autorización (roles, adminRequired, permisos de módulos, páginas).",
        "Aislamiento multi-empresa (SQLite vs MySQL).",
        "Angel IA: chat, reportes Excel, Cerebro (texto/imagen/Excel/Word/PDF), downloads.",
        "Uploads (checklist flota, conocimiento Angel).",
        "Front-end (XSS en shell, demo login, tokens en navegador).",
        "Hardening HTTP (CORS, headers, catch-all estático, límites de body).",
    ]:
        pdf.bullet(b)

    pdf.h1("3. Arquitectura y modelo de confianza")
    pdf.body(
        "El front estático en public/ consume APIs bajo /api/* con Bearer JWT. "
        "El middleware authRequired valida el token, carga el usuario activo y fija req.db según empresa del JWT. "
        "El portal Angel train usa un scope JWT distinto (angel_train) rechazado en rutas de usuario normal."
    )
    pdf.table(
        ["Componente", "Diseño", "Implicancia"],
        [
            ["SQLite (local)", "BD por empresa data/{slug}.db", "Aislamiento fuerte"],
            ["MySQL (prod)", "Conexión compartida gosercom_productivo_db", "Sin filtro empresa_id (legado PHP)"],
            ["Reportes Excel", "data/reportes/{empresa}/", "Aislado + validación BD"],
            ["Cerebro Angel", "data/angel-conocimiento/{empresa}/", "Archivos por empresa"],
            ["Fotos checklist", "data/uploads/checklist/{empresa}/ + API auth", "No públicas en /uploads"],
        ],
        [40, 75, 67],
    )

    # 4
    pdf.add_page()
    pdf.h1("4. Controles de seguridad implementados")
    pdf.h2("4.1 Autenticación y secretos")
    pdf.table(
        ["Control", "Estado", "Detalle"],
        [
            ["JWT_SECRET", "Mitigado", "Prod exige ≥32 chars; falla boot si falta/ejemplo"],
            ["ADMIN_PORTAL_PASSWORD", "Mitigado", "Obligatoria en prod; timing-safe"],
            ["ANGEL_TRAIN_PASSWORD", "Mitigado", "Obligatoria en prod; /acceso-angel.html"],
            ["ENCRYPTION_KEY", "Parcial", "Opcional; si no, deriva de JWT"],
            ["Hashes PHP $2y$", "Mitigado", "Normalización a $2a$ en login"],
            ["Rate limiting", "Mitigado", "Login 8/min; portales 5/min; recover 5/min"],
            ["JWT Angel train TTL", "Mitigado", "2h / 8h (antes hasta 30d)"],
            ["Demo en login", "Mitigado", "Eliminado hint admin@… / password"],
        ],
        [42, 22, 118],
    )
    pdf.h2("4.2 Autorización")
    pdf.table(
        ["Control", "Estado", "Detalle"],
        [
            ["adminRequired", "Mitigado", "Solo rol_id=1 o Administrador (no 'Administrativo')"],
            ["paginas_permitidas", "Mitigado", "Fail-closed; vacío ≠ acceso total"],
            ["Scope angel_train", "OK", "Rechazado en APIs de usuario"],
            ["Agenda camión", "Mitigado", "Crear/editar/export requieren permiso"],
            ["Checklist fotos", "Mitigado", "Subida con permiso; descarga autenticada"],
        ],
        [42, 22, 118],
    )
    pdf.h2("4.3 Angel IA y Cerebro")
    pdf.table(
        ["Control", "Estado", "Detalle"],
        [
            ["Descarga reportes", "Mitigado", "Carpeta por empresa + ownership/admin"],
            ["Listado reportes", "Mitigado", "Propios / admin; emails JP ocultos"],
            ["Sanitize reply", "OK", "Quita URLs inventadas; card Descargar"],
            ["Cerebro multi-formato", "OK", "Texto, imagen, Excel, Word, PDF ≤12 MB"],
            ["Mente ligera", "OK", "Chunks + ranking; no inyecta todo"],
            ["Portal train", "Parcial", "Rate limit + TTL; clave maestra compartida"],
        ],
        [42, 22, 118],
    )
    pdf.h2("4.4 Hardening HTTP y front")
    pdf.table(
        ["Control", "Estado", "Detalle"],
        [
            ["Headers", "OK", "nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy"],
            ["CORS", "Parcial", "Allowlist CORS_ORIGINS; vacío = permisivo"],
            ["Catch-all estático", "Mitigado", "Sin path traversal a .env"],
            ["Body size", "Mitigado", "2 MB general; 14 MB solo uploads"],
            ["XSS shell", "Mitigado", "escapeHtml nombre/empresa/subtítulo"],
            ["Chat Angel", "OK", "textContent + escape en cards"],
            ["/uploads/checklist", "Mitigado", "401 sin autenticación"],
        ],
        [42, 22, 118],
    )

    # 5
    pdf.add_page()
    pdf.h1("5. Hallazgos (antes → después)")
    pdf.body("Tabla consolidada de hallazgos de la auditoría y su estado tras remediación.")
    pdf.table(
        ["Sev.", "Hallazgo", "Estado", "Nota"],
        [
            ["Crítica", "MySQL sin aislamiento entre empresas", "Parcial", "Requiere empresa_id o BD separadas"],
            ["Alta", "JWT_SECRET por defecto forjable", "Mitigado", "Fail-closed en producción"],
            ["Alta", "Download Excel cross-tenant / IDOR", "Mitigado", "Dir por empresa + BD"],
            ["Alta", "admin via includes('admin')", "Mitigado", "Criterio estricto"],
            ["Alta", "XSS nombre en shell", "Mitigado", "escapeHtml"],
            ["Alta", "Catch-all path traversal", "Mitigado", "Resolución segura"],
            ["Alta", "Sin rate limit auth/portales", "Mitigado", "Limiter por IP"],
            ["Media", "Fotos checklist públicas", "Mitigado", "data/ + API auth"],
            ["Media", "Agenda export/create sin permiso", "Mitigado", "Checks añadidos"],
            ["Media", "Angel train clave + JWT largo", "Parcial", "TTL corto; MFA pendiente"],
            ["Media", "paginas_permitidas falla abierto", "Mitigado", "Default []"],
            ["Media", "JSON 20 MB global DoS", "Mitigado", "Límite 2 MB"],
            ["Baja", "Demo credentials en login", "Mitigado", "UI removida"],
        ],
        [18, 62, 22, 80],
    )

    pdf.h1("6. Superficies de ataque")
    pdf.h2("6.1 Endpoints sensibles")
    pdf.table(
        ["Endpoint", "Protección", "Datos"],
        [
            ["POST /api/auth/login", "Público + rate limit", "Credenciales"],
            ["POST /api/auth/acceso-sistema", "Clave maestra + RL", "Sesión admin"],
            ["POST /api/auth/acceso-angel", "Clave train + RL", "Cerebro / OpenAI"],
            ["GET .../reportes/download/:file", "JWT + ownership", "Excel operativos"],
            ["POST .../conocimiento/docs/*", "Token angel_train", "Conocimiento"],
            ["POST .../checklist/upload-foto", "JWT + permiso", "Fotos vehículos"],
            ["GET .../agenda/reporte-excel", "JWT + permiso", "Rutas/precios"],
        ],
        [70, 50, 62],
    )
    pdf.h2("6.2 Datos sensibles")
    for b in [
        "Credenciales y hashes bcrypt (compatibilidad PHP).",
        "API keys OpenAI cifradas en BD (AES-256-GCM).",
        "Emails de jefes de proyecto en reportes Angel.",
        "Fotos de inspección vehicular y patentes.",
        "Documentos del Cerebro (procedimientos, catálogos, PDFs).",
    ]:
        pdf.bullet(b)

    # 7-9
    pdf.add_page()
    pdf.h1("7. Riesgos residuales y backlog")
    pdf.table(
        ["Prioridad", "Riesgo", "Recomendación"],
        [
            ["Alta", "MySQL multi-tenant", "empresa_slug en tablas o BD por marca"],
            ["Media", "Token en localStorage", "Cookie httpOnly + SameSite"],
            ["Media", "Angel train sin identidad", "Admin real + MFA + auditoría"],
            ["Media", "CORS vacío permisivo", "CORS_ORIGINS con esercom.cl"],
            ["Media", "Embeddings / RAG futuro", "No mezclar docs entre empresas"],
            ["Baja", "Rate limit in-memory", "Redis si hay multi-proceso"],
            ["Baja", "Catálogo G uploads", "Mismo patrón que checklist"],
        ],
        [25, 50, 107],
    )

    pdf.h1("8. Requisitos operativos (producción)")
    pdf.table(
        ["Variable / acción", "Requisito"],
        [
            ["JWT_SECRET", "≥32 caracteres aleatorios (openssl rand -hex 32)"],
            ["ADMIN_PORTAL_PASSWORD", "Clave fuerte distinta del login de usuarios"],
            ["ANGEL_TRAIN_PASSWORD", "Clave fuerte; rotar periódicamente"],
            ["ENCRYPTION_KEY", "Recomendado (independiente del JWT)"],
            ["NODE_ENV", "production"],
            ["CORS_ORIGINS", "https://esercom.cl,https://www.esercom.cl"],
            ["OPENAI_API_KEY", "Solo en env; nunca en repositorio"],
            ["Reinicio Node", "Obligatorio tras desplegar cambios de seguridad"],
        ],
        [50, 132],
    )

    pdf.h1("9. Matriz de cobertura por dominio")
    pdf.table(
        ["Dominio", "Controles", "Cobertura"],
        [
            ["Identidad y acceso", "Login, JWT, portales, rate limit, admin", "Cubierto"],
            ["Autorización funcional", "Flags, permisos, páginas fail-closed", "Cubierto"],
            ["Tenant SQLite", "BD por empresa", "Cubierto"],
            ["Tenant MySQL", "BD compartida legado", "Parcial"],
            ["Protección de archivos", "Reportes, cerebro, checklist", "Cubierto"],
            ["IA / downloads", "Sanitize, cards, ownership", "Cubierto"],
            ["XSS", "Shell + chat", "Cubierto"],
            ["DoS / abuso API", "Body limits + rate limit auth", "Parcial"],
            ["Secretos y crypto", "Boot fail-closed + AES-GCM", "Cubierto"],
            ["Auditoría train", "Sin identidad de entrenador", "Parcial"],
        ],
        [45, 90, 47],
    )

    # 10-11
    pdf.add_page()
    pdf.h1("10. Conclusiones")
    pdf.body(
        "ESERCOM cuenta hoy con una base de controles alineada a buenas prácticas para una app empresarial en hosting compartido: "
        "secretos obligatorios, rate limiting en puertas de entrada, autorización más estricta, aislamiento de archivos sensibles "
        "y mitigación de XSS/traversal. El principal pendiente estratégico es el modelo multi-empresa en MySQL, heredado del PHP "
        "productivo: mientras todas las marcas compartan la misma base sin columna de tenant, el selector de empresa no debe "
        "interpretarse como aislamiento de seguridad."
    )
    pdf.body(
        "Se recomienda mantener este informe como baseline, re-auditar tras cambios en Angel/Cerebro o auth, "
        "y planificar MFA + cookies httpOnly como siguiente oleada."
    )

    pdf.h1("11. Anexos — Referencias de código")
    pdf.table(
        ["Tema", "Archivos"],
        [
            ["Config / boot seguro", "server/config.js, server/index.js"],
            ["Auth / rate limit", "server/routes/auth.js, server/middleware/rate-limit.js"],
            ["Admin / sesión", "server/middleware/admin.js, server/middleware/auth.js"],
            ["Reportes Excel", "server/services/angel-excel.js, server/routes/angel.js"],
            ["Cerebro", "server/services/angel-docs.js, server/routes/angel-train.js"],
            ["Checklist fotos", "server/services/checklist-flota.js"],
            ["Front shell / login", "public/js/auth.js, public/js/login.js, public/login.html"],
        ],
        [50, 132],
    )

    pdf.ln(8)
    pdf.set_draw_color(203, 213, 225)
    pdf.line(14, pdf.get_y(), 196, pdf.get_y())
    pdf.ln(4)
    pdf.set_font("ArialUni", "", 8)
    pdf.set_text_color(*GRAY)
    pdf.multi_cell(
        0,
        4,
        f"Documento generado automáticamente el {datetime.now().strftime('%d-%m-%Y a las %H:%M')}. "
        "Clasificación: Confidencial. Destinatario: administración ESERCOM.",
    )

    pdf.output(OUT)
    print(OUT)
    print(os.path.getsize(OUT))


if __name__ == "__main__":
    main()
