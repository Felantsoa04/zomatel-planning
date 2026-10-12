"""Répare word/document.xml : convertit les <w:r><w:rPr>...</w:rPr><w:instrText>TEXT</w:instrText></w:r>
en <w:t>TEXT</w:t> dans le même <w:r>, hormis le 1er run qui contient un simple espace PAGE."""
import zipfile, shutil, re
from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
path = r'C:/laragon/www/zomatel-planning/document/rapport_stage_zomatel.docx'
bak  = path + '.corrupt.bak'
shutil.copy(path, bak)
print('backup:', bak)

z = zipfile.ZipFile(bak)
data = z.read('word/document.xml')
root = etree.fromstring(data)
body = root.find(f'{{{W}}}body')

converted = 0
kept = 0
removed_runs = 0

def process_run(r):
    global converted, kept, removed_runs
    rPr = r.find(f'{{{W}}}rPr')
    instrs = r.findall(f'{{{W}}}instrText')
    if not instrs:
        return False
    texts = []
    for it in instrs:
        texts.append(it.text or '')
    content = ''.join(texts).strip()
    if content in ('', ' ', 'PAGE') or content.startswith('TOC') or content.startswith(' PAGE'):
        kept += 1
        return False
    # else: turn instrText into w:t, keep the run's rPr
    first = instrs[0]
    etree.QName(first)  # keep ns
    # remove other instrText-elems
    for it in instrs[1:]:
        r.remove(it)
    etree.QName(first)
    newt = etree.Element(f'{{{W}}}t')
    newt.text = ''.join(texts)
    # ensure xml:space preserve
    newt.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    parent = first.getparent()
    parent.replace(first, newt)
    converted += 1
    return True

for p in body.iter(f'{{{W}}}p'):
    runs = p.findall(f'{{{W}}}r')
    for r in runs:
        process_run(r)

print('converted:', converted)
print('kept as-is (PAGE/TOC):', kept)

new_xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)

# Recréer le zip en remplaçant document.xml
import os
with zipfile.ZipFile(bak) as zin, zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.namelist():
        if item == 'word/document.xml':
            zout.writestr(item, new_xml)
        else:
            zout.writestr(item, zin.read(item))
print('rewritten:', path)
