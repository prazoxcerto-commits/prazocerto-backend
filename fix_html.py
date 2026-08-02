import re

filepath = 'app.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the broken replacements
content = content.replace('NãotFound', 'NotFound')
content = content.replace('Nãotif', 'Notif')
content = content.replace('Nãode', 'Node')
content = content.replace('Nãome', 'Nome')
content = content.replace('moderNão', 'moderno')
content = content.replace('Nãovo', 'Novo')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fix applied to app.html")
