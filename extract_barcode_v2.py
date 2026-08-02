import fitz
import os
import sqlite3
import json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PDF_PATH = os.path.join(SCRIPT_DIR, "Catalogo_Danone_Barcode_v2.pdf")
IMG_DIR = os.path.join(SCRIPT_DIR, "imagens")
DB_PATH = os.path.join(SCRIPT_DIR, "catalogo.db")
JSON_PATH = os.path.join(SCRIPT_DIR, "output", "produtos_v2.json")

os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute('''CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ean TEXT UNIQUE,
    nome TEXT,
    foto TEXT
)''')

produtos_list = []

doc = fitz.open(PDF_PATH)
print(f"📄 Processing {PDF_PATH} - {len(doc)} pages")

for page_num, page in enumerate(doc):
    text = page.get_text()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if len(lines) < 5:
        continue
    
    brand = lines[0]
    prod1_name = lines[1]
    prod1_ean = lines[2]
    
    prod2_name = None
    prod2_ean = None
    if len(lines) >= 5:
        prod2_name = lines[3]
        prod2_ean = lines[4]
        
    images = page.get_images(full=True)
    if len(images) == 4:
        # Img 1: prod1 img, Img 2: prod1 barcode, Img 3: prod2 img, Img 4: prod2 barcode
        # Extract images
        for i, (prod_name, prod_ean) in enumerate([(prod1_name, prod1_ean), (prod2_name, prod2_ean)]):
            if not prod_ean: continue
            
            # Main image
            img_idx = i * 2
            xref = images[img_idx][0]
            pix = fitz.Pixmap(doc, xref)
            if pix.n > 3: pix = fitz.Pixmap(fitz.csRGB, pix)
            img_name = f"{prod_ean}.jpg"
            pix.save(os.path.join(IMG_DIR, img_name))
            pix = None
            
            # Barcode image
            bc_idx = i * 2 + 1
            xref_bc = images[bc_idx][0]
            pix_bc = fitz.Pixmap(doc, xref_bc)
            if pix_bc.n > 3: pix_bc = fitz.Pixmap(fitz.csRGB, pix_bc)
            bc_name = f"{prod_ean}_barcode.jpg"
            pix_bc.save(os.path.join(IMG_DIR, bc_name))
            pix_bc = None
            
            produtos_list.append({
                "ean": prod_ean,
                "nome": prod_name,
                "imagem": img_name
            })
            
            # Insert into SQLite
            cursor.execute('''INSERT INTO produtos (ean, nome, foto)
                              VALUES (?, ?, ?)
                              ON CONFLICT(ean) DO UPDATE SET
                              nome=excluded.nome, foto=excluded.foto''', 
                           (prod_ean, prod_name, img_name))
            
            print(f"✅ Extracted: {prod_ean} - {prod_name}")

conn.commit()
conn.close()

with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(produtos_list, f, ensure_ascii=False, indent=2)

print("✅ Finished extracting images and updating local SQLite database.")
