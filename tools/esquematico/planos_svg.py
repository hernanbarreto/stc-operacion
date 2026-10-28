#!/usr/bin/env python3
"""Convierte una hoja de plano PDF en tiras SVG vectoriales livianas para la web.

Cada tira cubre un rango de x de la hoja (coordenadas en puntos PDF, las mismas del esquemático para la hoja
1/25 del plano de señalización). La web carga sólo las tiras visibles y las dibuja como <image> sobre el lienzo,
de modo que el plano original se puede superponer al esquemático o mostrar sincronizado por PK.

Uso:
  python3 planos_svg.py --pdf plano.pdf --pagina 1 --salida ../../public/data/planos/sen_h1 [--ancho-tira 400] [--xmax 9380]
"""
from __future__ import annotations

import argparse
import json
import math
import os
from xml.sax.saxutils import escape

import pymupdf as fitz


def num(v: float) -> str:
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def rgb(c) -> str:
    if c is None:
        return 'none'
    r, g, b = (max(0, min(255, round(v * 255))) for v in c[:3])
    return f'#{r:02x}{g:02x}{b:02x}'


def path_d(items, close: bool) -> str:
    out = []
    cur = None
    for it in items:
        op = it[0]
        if op == 'l':
            p1, p2 = it[1], it[2]
            if cur is None or abs(cur.x - p1.x) > 1e-3 or abs(cur.y - p1.y) > 1e-3:
                out.append(f'M{num(p1.x)} {num(p1.y)}')
            out.append(f'L{num(p2.x)} {num(p2.y)}')
            cur = p2
        elif op == 'c':
            p1, c1, c2, p2 = it[1], it[2], it[3], it[4]
            if cur is None or abs(cur.x - p1.x) > 1e-3 or abs(cur.y - p1.y) > 1e-3:
                out.append(f'M{num(p1.x)} {num(p1.y)}')
            out.append(f'C{num(c1.x)} {num(c1.y)} {num(c2.x)} {num(c2.y)} {num(p2.x)} {num(p2.y)}')
            cur = p2
        elif op == 're':
            r = it[1]
            out.append(f'M{num(r.x0)} {num(r.y0)}h{num(r.width)}v{num(r.height)}h{num(-r.width)}Z')
            cur = None
        elif op == 'qu':
            q = it[1]
            out.append(f'M{num(q.ul.x)} {num(q.ul.y)}L{num(q.ur.x)} {num(q.ur.y)}L{num(q.lr.x)} {num(q.lr.y)}'
                       f'L{num(q.ll.x)} {num(q.ll.y)}Z')
            cur = None
    if close and out and not out[-1].endswith('Z'):
        out.append('Z')
    return ''.join(out)


def style_of(d) -> tuple:
    t = d.get('type') or ''
    stroke = rgb(d.get('color')) if 's' in t else 'none'
    fill = rgb(d.get('fill')) if 'f' in t else 'none'
    width = num(max(d.get('width') or 0.0, 0.05)) if 's' in t else ''
    dashes = d.get('dashes') or ''
    dash = ''
    if dashes and dashes.strip() not in ('[] 0', '[]0', ''):
        try:
            arr = dashes[dashes.index('[') + 1:dashes.index(']')].split()
            dash = ' '.join(num(float(a)) for a in arr if float(a) > 0)
        except ValueError:
            dash = ''
    so = d.get('stroke_opacity')
    fo = d.get('fill_opacity')
    eo = 'evenodd' if d.get('even_odd') else ''
    cap = d.get('lineCap')
    cap = cap[0] if isinstance(cap, (list, tuple)) else cap
    capname = {1: 'round', 2: 'square'}.get(cap or 0, '')
    return (stroke, fill, width, dash, '' if so in (None, 1) else num(so), '' if fo in (None, 1) else num(fo), eo, capname)


def style_attr(st: tuple) -> str:
    stroke, fill, width, dash, so, fo, eo, cap = st
    a = [f'fill="{fill}"', f'stroke="{stroke}"']
    if width:
        a.append(f'stroke-width="{width}"')
    if dash:
        a.append(f'stroke-dasharray="{dash}"')
    if so:
        a.append(f'stroke-opacity="{so}"')
    if fo:
        a.append(f'fill-opacity="{fo}"')
    if eo:
        a.append('fill-rule="evenodd"')
    if cap:
        a.append(f'stroke-linecap="{cap}"')
    return ' '.join(a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--pagina', type=int, default=1)
    ap.add_argument('--salida', required=True)
    ap.add_argument('--ancho-tira', type=float, default=400.0)
    ap.add_argument('--xmax', type=float, default=None, help='descartar lo que empiece a la derecha (cajetín)')
    ap.add_argument('--titulo', default='')
    args = ap.parse_args()

    page = fitz.open(args.pdf)[args.pagina - 1]
    W, H = page.rect.width, page.rect.height
    xmax = args.xmax or W
    n = math.ceil(xmax / args.ancho_tira)
    tiras = [dict(x0=i * args.ancho_tira, x1=min(xmax, (i + 1) * args.ancho_tira), objs=[]) for i in range(n)]

    def add(bbox, z, svg):
        x0, x1 = bbox[0], bbox[2]
        if x0 > xmax:
            return
        for t in tiras:
            if x1 >= t['x0'] - 0.5 and x0 <= t['x1'] + 0.5:
                t['objs'].append((z, svg))

    # dibujos: fusionar consecutivos con el mismo estilo
    z = 0
    prev_st, prev_d, prev_bb = None, [], None
    def flush():
        if prev_st is not None and prev_d:
            add(prev_bb, z, f'<path {style_attr(prev_st)} d="{"".join(prev_d)}"/>')

    for d in page.get_drawings():
        st = style_of(d)
        dd = path_d(d['items'], d.get('closePath', False))
        if not dd:
            continue
        r = d['rect']
        bb = (r.x0, r.y0, r.x1, r.y1)
        merge = (st == prev_st and prev_bb is not None and bb[0] >= prev_bb[0] - 40 and bb[2] <= prev_bb[2] + 40
                 and max(bb[2], prev_bb[2]) - min(bb[0], prev_bb[0]) < args.ancho_tira / 4)
        if merge:
            prev_d.append(dd)
            prev_bb = (min(prev_bb[0], bb[0]), min(prev_bb[1], bb[1]), max(prev_bb[2], bb[2]), max(prev_bb[3], bb[3]))
        else:
            flush()
            z += 1
            prev_st, prev_d, prev_bb = st, [dd], bb
    flush()

    # textos
    for b in page.get_text('dict')['blocks']:
        for line in b.get('lines', []):
            dx, dy = line['dir']
            ang = math.degrees(math.atan2(dy, dx))
            for s in line['spans']:
                txt = s['text']
                if not txt.strip():
                    continue
                z += 1
                ox, oy = s['origin']
                col = f'#{s["color"]:06x}'
                tr = f' transform="rotate({num(ang)} {num(ox)} {num(oy)})"' if abs(ang) > 0.5 else ''
                bold = ' font-weight="bold"' if s['flags'] & 16 else ''
                add(s['bbox'], z, f'<text x="{num(ox)}" y="{num(oy)}" font-size="{num(s["size"])}" fill="{col}"{bold}{tr}>'
                                  f'{escape(txt)}</text>')

    os.makedirs(args.salida, exist_ok=True)
    index = dict(titulo=args.titulo, pdf=os.path.basename(args.pdf), pagina=args.pagina, ancho=W, alto=H, tiras=[])
    total = 0
    for i, t in enumerate(tiras):
        objs = sorted(t['objs'], key=lambda o: o[0])
        body = '\n'.join(o[1] for o in objs)
        w = t['x1'] - t['x0']
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{num(w)}" height="{num(H)}" '
               f'viewBox="{num(t["x0"])} 0 {num(w)} {num(H)}" font-family="Arial, Helvetica, sans-serif">\n'
               f'<rect x="{num(t["x0"])}" y="0" width="{num(w)}" height="{num(H)}" fill="#ffffff"/>\n{body}\n</svg>\n')
        fn = f't{i:02d}.svg'
        with open(os.path.join(args.salida, fn), 'w', encoding='utf-8') as f:
            f.write(svg)
        total += len(svg)
        index['tiras'].append(dict(x0=t['x0'], x1=t['x1'], archivo=fn, bytes=len(svg)))
    with open(os.path.join(args.salida, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)
    print(f'{len(tiras)} tiras, {total / 1e6:.2f} MB en {args.salida}')


if __name__ == '__main__':
    main()
