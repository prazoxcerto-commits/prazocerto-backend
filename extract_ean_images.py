"""
extract_ean_images.py
Extrai EAN + imagem de cada produto dos PDFs de Ficha Técnica.
Salva: output/images/<EAN>.jpg  +  output/produtos.json
"""
import fitz
import os
import json
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")
IMG_DIR    = os.path.join(OUTPUT_DIR, "images")

os.makedirs(IMG_DIR, exist_ok=True)

PDF_FILES = [
    "Ficha_tecnica_produtos.pdf",
    "Ficha_tecnica_produtos-1.pdf",
    "Ficha_tecnica_produtos-2.pdf",
]

EAN_RE  = re.compile(r'EAN[:\s]+(\d{8,14})')
SKU_RE  = re.compile(r'SKU[:\s]+(\d+)')
NAME_RE = re.compile(r'^(.+?)(?:\n|SKU)', re.MULTILINE)

produtos = []
seen_eans = set()
total_pages = 0

for fname in PDF_FILES:
    path = os.path.join(SCRIPT_DIR, fname)
    if not os.path.exists(path):
        print(f"[SKIP] {fname} não encontrado")
        continue

    doc = fitz.open(path)
    print(f"\n📄 {fname} — {len(doc)} páginas")

    for page_num, page in enumerate(doc):
        text = page.get_text()

        # --- Extrair EAN ---
        ean_match = EAN_RE.search(text)
        if not ean_match:
            print(f"  [pág {page_num+1}] ⚠️  EAN não encontrado, pulando...")
            continue
        ean = ean_match.group(1).strip()

        # Evitar duplicatas entre os 3 PDFs
        if ean in seen_eans:
            print(f"  [pág {page_num+1}] ⏭️  EAN {ean} duplicado, pulando...")
            continue
        seen_eans.add(ean)

        # --- Extrair nome do produto (primeira linha da página) ---
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        # Ignorar linha "Detalhes dos produtos" se existir
        name_lines = [l for l in lines if l not in ("Detalhes dos produtos",)]
        nome = name_lines[0] if name_lines else "Desconhecido"

        # --- Extrair SKU ---
        sku_match = SKU_RE.search(text)
        sku = sku_match.group(1) if sku_match else ""

        # --- Extrair Categoria / Segmento / Marca ---
        cat   = re.search(r'Categoria[:\s]+(.+)', text)
        seg   = re.search(r'Segmento[:\s]+(.+)', text)
        marca = re.search(r'Marca[:\s]+(.+)', text)

        produto = {
            "ean":       ean,
            "sku":       sku,
            "nome":      nome,
            "categoria": cat.group(1).strip()   if cat   else "",
            "segmento":  seg.group(1).strip()   if seg   else "",
            "marca":     marca.group(1).strip() if marca else "",
            "imagem":    f"images/{ean}.jpg",
        }

        # --- Extrair imagem ---
        img_saved = False
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                base_img = doc.extract_image(xref)
                img_bytes = base_img["image"]
                ext = base_img.get("ext", "jpeg")

                # Converter para JPEG via pixmap se necessário
                pix = fitz.Pixmap(doc, xref)
                if pix.n > 3:  # CMYK → RGB
                    pix = fitz.Pixmap(fitz.csRGB, pix)

                img_path = os.path.join(IMG_DIR, f"{ean}.jpg")
                pix.save(img_path)
                img_saved = True
                pix = None
                break
            except Exception as e:
                print(f"  [pág {page_num+1}] ⚠️  Erro ao extrair imagem: {e}")

        if not img_saved:
            produto["imagem"] = ""

        produtos.append(produto)
        total_pages += 1
        print(f"  ✅ [{page_num+1:03d}] EAN={ean} | {nome[:45]}")

    doc.close()

# --- Salvar JSON ---
json_path = os.path.join(OUTPUT_DIR, "produtos.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(produtos, f, ensure_ascii=False, indent=2)

print(f"\n{'='*60}")
print(f"✅ Extração concluída!")
print(f"   Produtos extraídos : {len(produtos)}")
print(f"   Páginas processadas: {total_pages}")
print(f"   JSON salvo em      : {json_path}")
print(f"   Imagens salvas em  : {IMG_DIR}")
print(f"{'='*60}")
