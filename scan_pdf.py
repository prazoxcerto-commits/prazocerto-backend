import fitz
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
pdf_path = os.path.join(script_dir, "Ficha_tecnica_produtos.pdf")

doc = fitz.open(pdf_path)
print(f"Total de páginas: {len(doc)}")

# Escanear as primeiras 5 páginas para entender o layout
for i in range(min(5, len(doc))):
    page = doc[i]
    print(f"\n{'='*50}")
    print(f"PÁGINA {i+1}")
    print(f"{'='*50}")
    text = page.get_text()
    print(text[:3000])
    # Ver quantas imagens há na página
    img_list = page.get_images(full=True)
    print(f"\n[IMAGENS NA PÁGINA]: {len(img_list)}")
    for img in img_list:
        print(f"  xref={img[0]}, w={img[2]}, h={img[3]}, colorspace={img[5]}")

doc.close()
