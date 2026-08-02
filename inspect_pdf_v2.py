import fitz
import sys

doc = fitz.open("Catalogo_Danone_Barcode_v2.pdf")
print(f"Total pages: {len(doc)}")
for i in range(min(3, len(doc))):
    page = doc[i]
    print(f"--- Page {i+1} ---")
    print(page.get_text())
    images = page.get_images(full=True)
    print(f"Images: {len(images)}")
    for j, img in enumerate(images):
        print(f"  Image {j+1}: {img}")
