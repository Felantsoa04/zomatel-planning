import sys, zipfile, re
from lxml import etree

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def extract(path):
    z = zipfile.ZipFile(path)
    out = []
    for name in ['word/document.xml']:
        try:
            data = z.read(name)
        except KeyError:
            continue
        root = etree.fromstring(data)
        body = root.find('w:body', NS)
        def walk(el, depth=0):
            for child in el:
                tag = etree.QName(child).localname
                if tag == 'p':
                    texts = child.findall('.//w:t', NS)
                    txt = ''.join(t.text or '' for t in texts)
                    # style
                    style = child.find('w:pPr/w:pStyle', NS)
                    sv = style.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val') if style is not None else ''
                    if txt.strip():
                        out.append(f"[{sv}] {txt}")
                elif tag == 'tbl':
                    out.append('--- TABLE ---')
                    for row in child.findall('w:tr', NS):
                        cells = []
                        for tc in row.findall('w:tc', NS):
                            ctext = ' '.join(t.text or '' for t in tc.findall('.//w:t', NS))
                            cells.append(ctext.strip())
                        out.append(' | '.join(cells))
                    out.append('--- END TABLE ---')
                elif tag == 'sdt':
                    walk(child, depth)
        walk(body)
    return '\n'.join(out)

print(extract(sys.argv[1]))
