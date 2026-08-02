import json
import os
with open(r'output/produtos_v2.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
for p in data:
    if 'Corpus' in p['nome'] and '540g' in p['nome']:
        print(p)
        print(f"Img exists: {os.path.exists(os.path.join('imagens', p['imagem']))}")
    if 'YoPRO' in p['nome'] or 'yopro' in p['nome'].lower():
        if '15g' in p['nome'] and '250' in p['nome']:
            print(p)
            print(f"Img exists: {os.path.exists(os.path.join('imagens', p['imagem']))}")
