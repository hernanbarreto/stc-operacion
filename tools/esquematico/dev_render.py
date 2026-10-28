"""Render de depuración: plano atenuado + secciones extraídas (colores) + nombres."""
import sys, json, colorsys, hashlib
import pymupdf
from PIL import Image, ImageDraw, ImageFont
pdf, js, x0, y0, x1, y1, z, out = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:8]), sys.argv[8]
d = json.load(open(js))
doc = pymupdf.open(pdf); pg = doc[0]
pix = pg.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=pymupdf.Rect(x0, y0, x1, y1))
im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
im = Image.blend(im, Image.new('RGB', im.size, 'white'), 0.6)
dr = ImageDraw.Draw(im)
T = lambda x, y: ((x - x0) * z, (y - y0) * z)
def col(s):
    h = int(hashlib.md5(s.encode()).hexdigest()[:6], 16) / 0xffffff
    r, g, b = colorsys.hsv_to_rgb(h, 0.9, 0.85); return (int(r*255), int(g*255), int(b*255))
for v in d['vias']:
    a = T(v['pts'][0], v['pts'][1]); b = T(v['pts'][2], v['pts'][3])
    dr.line([a, b], fill=(255, 0, 0), width=5)
for s in d['secciones']:
    c = col(s['id'])
    for t in s['tramos']:
        dr.line([T(t[0], t[1]), T(t[2], t[3])], fill=c, width=5)
    t = s['tramos'][0]; mx = (t[0] + t[2]) / 2; my = (t[1] + t[3]) / 2
    if x0 <= mx <= x1: dr.text(T(mx, my + 2.5), s['id'], fill=c)
for j in d['juntas']:
    if x0 <= j['x'] <= x1:
        cx, cy = T(j['x'], j['y']); c = (0, 150, 0) if j['tipo'] == 'fisica' else (90, 90, 90)
        dr.line([(cx, cy - 8), (cx, cy + 8)], fill=c, width=2)
for a in d['agujas']:
    if 'x' in a and x0 <= a['x'] <= x1:
        cx, cy = T(a['x'], a['y']); dr.ellipse([cx-5, cy-5, cx+5, cy+5], outline='black', width=2); dr.text((cx+6, cy-12), a['id'], fill='black')
for s in d['senales']:
    if s.get('x') and x0 <= s['x'] <= x1:
        cx, cy = T(s['x'], s['y']); arrow = {'PAN': '>', 'OBS': '<'}.get(s.get('sentido'), '?')
        dr.text((cx - 3, cy - 18 if s.get('lado') == 'arriba' else cy + 6), s['id'] + arrow, fill=(180, 0, 180))
im.save(out)
