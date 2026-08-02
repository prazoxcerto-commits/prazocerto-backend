"""
Script para inspecionar a estrutura real do arquivo DOCX
e entender como imagens e textos estao organizados.
"""
import zipfile
import xml.etree.ElementTree as ET

namespaces = {
    'w':   'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'a':   'http://schemas.openxmlformats.org/drawingml/2006/main',
    'pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    'r':   'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'rel': 'http://schemas.openxmlformats.org/package/2006/relationships',
    'wp':  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
}

with zipfile.ZipFile("Catalogo_Danone.docx") as z:
    xml_content = z.read('word/document.xml')
    rels_content = z.read('word/_rels/document.xml.rels')

rels_tree = ET.fromstring(rels_content)
rels = {}
for rel in rels_tree.findall('.//rel:Relationship', namespaces):
    rels[rel.attrib['Id']] = rel.attrib.get('Target','')

tree = ET.fromstring(xml_content)
body = tree.find('w:body', namespaces)
paragraphs = body.findall('w:p', namespaces)

print(f"Total de paragrafos: {len(paragraphs)}")
print()

count = 0
for i, para in enumerate(paragraphs):
    texts = [t.text for t in para.findall('.//w:t', namespaces) if t.text]
    full_text = "".join(texts).strip()
    
    images = []
    for blip in para.findall('.//a:blip', namespaces):
        embed_id = blip.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
        if embed_id and embed_id in rels:
            images.append(rels[embed_id])

    if full_text or images:
        print(f"[{i}] TEXT: '{full_text[:60]}' | IMAGES: {images}")
        count += 1
        if count > 30:
            print("... (truncado)")
            break
