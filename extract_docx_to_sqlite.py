"""
Extrator corrigido: a imagem vem APOS o EAN no documento.
Estrutura real do DOCX:
  Paragrafo: Nome do produto
  Paragrafo: EAN: XXXXXXX
  Paragrafo: (vazio com imagem embutida)
"""
import sqlite3
import os
import zipfile
import xml.etree.ElementTree as ET

os.makedirs('imagens', exist_ok=True)

# Limpar banco existente e recriar
conn = sqlite3.connect('catalogo.db')
cursor = conn.cursor()
cursor.execute('DROP TABLE IF EXISTS produtos')
cursor.execute('''
CREATE TABLE produtos (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    ean  TEXT UNIQUE,
    nome TEXT,
    foto TEXT
)
''')
cursor.execute('CREATE INDEX IF NOT EXISTS idx_ean ON produtos(ean)')
conn.commit()

namespaces = {
    'w':   'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'a':   'http://schemas.openxmlformats.org/drawingml/2006/main',
    'r':   'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
}

with zipfile.ZipFile("Catalogo_Danone.docx") as docx_zip:
    xml_content  = docx_zip.read('word/document.xml')
    rels_content = docx_zip.read('word/_rels/document.xml.rels')

    # Mapear ID de relacionamento -> caminho da imagem
    rels_tree = ET.fromstring(rels_content)
    rels = {}
    for rel in rels_tree.findall('.//rel:Relationship', namespaces):
        rels[rel.attrib['Id']] = rel.attrib.get('Target', '')

    tree = ET.fromstring(xml_content)
    body = tree.find('w:body', namespaces)
    paragraphs = body.findall('w:p', namespaces)

    # Construir lista de entradas: { 'text': ..., 'images': [...] }
    entries = []
    for para in paragraphs:
        texts = [t.text for t in para.findall('.//w:t', namespaces) if t.text]
        full_text = "".join(texts).strip()

        images = []
        for blip in para.findall('.//a:blip', namespaces):
            embed_id = blip.attrib.get(
                '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed'
            )
            if embed_id and embed_id in rels:
                target = rels[embed_id]
                if 'media/' in target:
                    images.append(target)

        entries.append({'text': full_text, 'images': images})

    # Agora percorrer sequencialmente: Nome -> EAN -> Imagem
    img_counter = 1
    saved = 0

    i = 0
    while i < len(entries):
        entry = entries[i]
        txt = entry['text']

        # Detectar linha de nome (nao comeca com # nem EAN:)
        if txt and not txt.startswith('#') and not txt.startswith('EAN:') and not entry['images']:
            nome = txt
            # Proximo deve ser EAN
            ean = None
            foto_path = None

            if i + 1 < len(entries) and entries[i+1]['text'].startswith('EAN:'):
                ean_raw = entries[i+1]['text'].replace('EAN:', '').strip()
                ean = ean_raw
                i += 2  # pula nome e ean
            else:
                i += 1
                continue

            # Proximo paragrafo pode ter a imagem (pode ser vazio com imagem)
            if i < len(entries) and entries[i]['images']:
                img_rel = entries[i]['images'][0]
                # Extrair imagem do zip
                zip_path = 'word/' + img_rel
                ext = img_rel.split('.')[-1].lower()
                img_filename = f"img_{img_counter}.{ext}"
                try:
                    img_data = docx_zip.read(zip_path)
                    with open(os.path.join('imagens', img_filename), 'wb') as f:
                        f.write(img_data)
                    foto_path = img_filename
                    img_counter += 1
                except Exception as e:
                    print(f"  ERRO ao extrair imagem {zip_path}: {e}")
                i += 1  # pula o paragrafo da imagem

            # Salvar no banco
            if nome and ean:
                try:
                    cursor.execute(
                        "INSERT OR REPLACE INTO produtos (ean, nome, foto) VALUES (?, ?, ?)",
                        (ean, nome, foto_path)
                    )
                    conn.commit()
                    saved += 1
                    print(f"[OK] EAN={ean} | Nome={nome[:50]} | Foto={foto_path}")
                except Exception as e:
                    print(f"  ERRO ao salvar {ean}: {e}")
        else:
            i += 1

conn.close()
print(f"\nTotal salvo: {saved} produtos")
