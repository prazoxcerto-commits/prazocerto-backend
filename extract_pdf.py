import fitz  # PyMuPDF
import os

pdf_files = [
    "Ficha_tecnica_produtos.pdf",
    "Ficha_tecnica_produtos-1.pdf",
    "Ficha_tecnica_produtos-2.pdf",
]

script_dir = os.path.dirname(os.path.abspath(__file__))

for fname in pdf_files:
    path = os.path.join(script_dir, fname)
    if not os.path.exists(path):
        print(f"[NÃO ENCONTRADO] {fname}")
        continue
    doc = fitz.open(path)
    print(f"\n{'='*60}")
    print(f"ARQUIVO: {fname} | Páginas: {len(doc)}")
    print(f"{'='*60}")
    # Mostrar as 3 primeiras páginas para entender a estrutura
    for i, page in enumerate(doc):
        if i >= 3:
            print(f"... ({len(doc) - 3} páginas restantes)")
            break
        print(f"\n--- PÁGINA {i+1} ---")
        text = page.get_text()
        print(text[:2000])  # Primeiros 2000 chars de cada página
    doc.close()
