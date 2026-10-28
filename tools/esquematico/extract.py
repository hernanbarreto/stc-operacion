#!/usr/bin/env python3
"""Genera el esquemático de la Línea 1 (public/data/esquematico_l1.json) a partir de los planos.

Fuentes (vectoriales, exportadas de AutoCAD):
  --senal  2022-SIE-CB.IXL-L1MO-000-II-41252-P  Plano de distribución de señalización (hoja 1/25 = línea completa)
  --cdv    2022-MRRC-CB.IXL-L1MO-000-III-47802987-P  Plano de distribución de circuitos de vía (bifilar)

La geometría (coordenadas x/y) es la del plano de señalización, en puntos PDF. El plano no está a
escala: la x es monótona con el PK pero con escala variable, por eso cada elemento lleva su PK leído
del encabezado del plano.

Uso:
  python3 extract.py --senal <pdf> --cdv <pdf> --out ../../public/data/esquematico_l1.json [--debug-png x.png]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
from collections import defaultdict

from header import HeaderEntry, read_header
from pdfgeom import Page, Seg, Text, load_page, parse_pk, point_seg_dist, seg_intersection
from tracks import TrackGraph, _norm, build_track_graph, chain_dashes, is_track_candidate, merge_collinear

AREA = (40, 100, 9356, 400)       # zona de dibujo de vías en la hoja 1/25 (pt)
GRAY = (0.29, 0.29, 0.29)
GREEN_TICK = (0.0, 0.8, 0.0)
BLACK = (0.0, 0.0, 0.0)
RED = (1.0, 0.0, 0.0)
LAMP_COLORS = {(1.0, 0.0, 0.0): 'R', (0.0, 1.0, 0.0): 'V', (1.0, 1.0, 0.0): 'A'}

STATIONS = [
    # código, nombre, id TGMT (MX1xx)
    ('PAN', 'Pantitlán', 101), ('ZAR', 'Zaragoza', 102), ('GOM', 'Gómez Farías', 106),
    ('BOU', 'Boulevard Puerto Aéreo', 107), ('BAL', 'Balbuena', 108), ('MOC', 'Moctezuma', 109),
    ('SLA', 'San Lázaro', 110), ('CAN', 'Candelaria', 111), ('MER', 'Merced', 112),
    ('PIN', 'Pino Suárez', 113), ('ISA', 'Isabel la Católica', 114), ('SAL', 'Salto del Agua', 115),
    ('BAD', 'Balderas', 116), ('CUA', 'Cuauhtémoc', 117), ('INS', 'Insurgentes', 118),
    ('SEV', 'Sevilla', 119), ('CHP', 'Chapultepec', 120), ('JNA', 'Juanacatlán', 121),
    ('TCY', 'Tacubaya', 122), ('OBS', 'Observatorio', 123),
]
ST_CODES = [s[0] for s in STATIONS]
STATION_RE = '|'.join(ST_CODES + ['TZA'])   # TZA = Taller Zaragoza

# Ids de estación TGMT 24..46 = AVC (mapeo ya usado por la app en useExcelProcessor.ts).
# Nota: la app lo llama AVC20PIN; en el plano de señalización figura como AVC20BPIN.
AVC_TGMT = {
    'AVC16PAN': 24, 'AVC26PAN': 25, 'AVC46PAN': 26, 'AVC14PAN': 27, 'AVC24PAN': 28, 'AVC44PAN': 29,
    'AVC64PAN': 30, 'AVC62PAN': 31, 'AVC24ZAR': 32, 'AVC14ZAR': 33, 'AVC14BAL': 34, 'AVC20BPIN': 35,
    'AVCZSAL': 36, 'AVC20ABAD': 37, 'AVC20CHP': 38, 'AVC54OBS': 39, 'AVC34OBS': 40, 'AVC14OBS': 41,
    'AVC24OBS': 42, 'AVC44OBS': 43, 'AVC64OBS': 44, 'AVC84OBS': 45, 'AVC104OBS': 46,
}


def r2(v):
    return None if v is None else round(float(v), 2)


def r3(v):
    return None if v is None else round(float(v), 3)


def station_of(name: str) -> str | None:
    m = re.search(rf'({STATION_RE})\d?\*?$', name)
    return m.group(1) if m else None


# ───────────────────────────── vías ─────────────────────────────

def edge_len(e):
    return math.dist(e['pts'][0], e['pts'][1])


def edge_y_at(e, x):
    (x0, y0), (x1, y1) = e['pts']
    if abs(x1 - x0) < 1e-9:
        return (y0 + y1) / 2
    t = (x - x0) / (x1 - x0)
    return y0 + t * (y1 - y0)


def edge_xrange(e):
    xs = [e['pts'][0][0], e['pts'][1][0]]
    return min(xs), max(xs)


def nearest_edge(g: TrackGraph, x, y, maxd=1e9):
    best = (maxd, None, None)
    for k, e in enumerate(g.edges):
        (a, b) = e['pts']
        d, t = point_seg_dist(x, y, a[0], a[1], b[0], b[1])
        if d < best[0]:
            best = (d, k, t)
    return best


def name_tracks(g: TrackGraph, texts: list[Text]):
    """Asigna nombre de vía a cada arista usando las etiquetas 'VÍA x' y continuidad colineal."""
    names: dict[int, str] = {}
    for t in texts:
        if not t.horizontal:
            continue
        m = re.match(r'^V[ÍI]A\s+([0-9A-Z]+)$', t.t)
        m2 = re.match(r'^L[ÍI]NEA\s+(\d)$', t.t)
        if not m and not m2:
            continue
        via = ('V' + m.group(1)) if m else ('L' + m2.group(1))
        best = None
        for k, e in enumerate(g.edges):
            x0, x1 = edge_xrange(e)
            if not (x0 - 1 <= t.cx <= x1 + 1):
                continue
            dy = abs(edge_y_at(e, t.cx) - t.cy)
            lim = 14 if via.startswith('V') else 22
            if dy < lim and (best is None or dy < best[0]):
                best = (dy, k)
        if best:
            names.setdefault(best[1], via)
    inc = defaultdict(list)
    for k, e in enumerate(g.edges):
        inc[e['a']].append(k)
        inc[e['b']].append(k)

    def direction(k, n):
        e = g.edges[k]
        o = e['b'] if e['a'] == n else e['a']
        (x0, y0), (x1, y1) = g.nodes[n], g.nodes[o]
        L = math.hypot(x1 - x0, y1 - y0) or 1
        return ((x1 - x0) / L, (y1 - y0) / L)

    changed = True
    while changed:
        changed = False
        for k, e in enumerate(g.edges):
            if k in names:
                continue
            for n in (e['a'], e['b']):
                dk = direction(k, n)
                for j in inc[n]:
                    if j == k or j not in names:
                        continue
                    dj = direction(j, n)
                    if dk[0] * dj[0] + dk[1] * dj[1] < -0.995:   # continuación colineal
                        names[k] = names[j]
                        changed = True
                        break
                if k in names:
                    break
    # aristas sin nombre: diagonales / espadillas → nombre de las vías que unen (búsqueda por aristas sin nombre)
    final = dict(names)
    for k, e in enumerate(g.edges):
        if k in names:
            continue
        ends = set()
        seen = {k}
        frontier = [k]
        for _ in range(4):
            nxt = []
            for kk in frontier:
                ee = g.edges[kk]
                for n in (ee['a'], ee['b']):
                    for j in inc[n]:
                        if j in seen:
                            continue
                        seen.add(j)
                        if j in names:
                            ends.add(names[j])
                        else:
                            nxt.append(j)
            frontier = nxt
        final[k] = '/'.join(sorted(ends)) if ends else '?'
    return final


# ───────────────────────────── juntas y secciones ─────────────────────────────

def find_ticks(segs: list[Seg], g: TrackGraph, raw_lines):
    """Marcas transversales sobre la vía: verde = junta física de CDV; gris = límite de sección.

    El cruce se evalúa contra las líneas de vía originales del plano (antes de simplificar el grafo)
    y luego se proyecta sobre la arista final más cercana."""
    ticks = []
    for s in segs:
        if abs(s.width - 0.24) > 0.01 or s.length < 2.0 or s.length > 4.6:
            continue
        if s.color not in (GRAY, GREEN_TICK):
            continue
        mx, my = s.mid
        hit = None
        on_other = False
        for (ax, ay, bx, by) in raw_lines:
            d0, _ = point_seg_dist(s.x0, s.y0, ax, ay, bx, by)
            d1, _ = point_seg_dist(s.x1, s.y1, ax, ay, bx, by)
            if d0 < 0.35 and d1 < 0.35:
                on_other = True
                break
            dm, tm = point_seg_dist(mx, my, ax, ay, bx, by)
            if dm > 1.4 or not (-0.02 <= tm <= 1.02):
                continue
            L = math.hypot(bx - ax, by - ay) or 1e-9
            ux, uy = (bx - ax) / L, (by - ay) / L
            ang_s = math.atan2(s.y1 - s.y0, s.x1 - s.x0)
            dang = abs((math.atan2(uy, ux) - ang_s + math.pi / 2) % math.pi - math.pi / 2)
            if dang < 0.2:
                continue
            s0 = (s.x0 - ax) * uy - (s.y0 - ay) * ux
            s1 = (s.x1 - ax) * uy - (s.y1 - ay) * ux
            if s0 * s1 >= 0 or min(abs(s0), abs(s1)) < 0.2:
                continue
            r = seg_intersection((ax, ay, bx, by), (s.x0, s.y0, s.x1, s.y1))
            if r is None:
                continue
            if hit is None or dm < hit[0]:
                hit = (dm, r[0], r[1])
        if on_other or hit is None:
            continue
        px, py = hit[1], hit[2]
        d, k, t = nearest_edge(g, px, py, maxd=2.5)
        if k is None:
            continue
        e = g.edges[k]
        (a, b) = e['pts']
        L = edge_len(e)
        tc = min(1.0, max(0.0, t))
        qx, qy = a[0] + tc * (b[0] - a[0]), a[1] + tc * (b[1] - a[1])
        ticks.append(dict(kind='fisica' if s.color == GREEN_TICK else 'virtual', edge=k, t=tc, x=qx, y=qy,
                          s=tc * L))
    # fusionar duplicados (la junta física también tiene marca gris)
    merged = []
    for tk in sorted(ticks, key=lambda q: (q['edge'], q['s'])):
        if merged and merged[-1]['edge'] == tk['edge'] and abs(merged[-1]['s'] - tk['s']) < 0.8:
            if tk['kind'] == 'fisica':
                merged[-1]['kind'] = 'fisica'
            continue
        merged.append(dict(tk))
    return merged


def split_pieces(g: TrackGraph, ticks):
    """Divide las aristas en tramos entre marcas. Devuelve tramos y su conectividad."""
    by_edge = defaultdict(list)
    for i, tk in enumerate(ticks):
        by_edge[tk['edge']].append(i)
    pieces = []
    for k, e in enumerate(g.edges):
        (a, b) = e['pts']
        L = edge_len(e)
        cuts = sorted(by_edge[k], key=lambda i: ticks[i]['s'])
        ss = [0.0] + [ticks[i]['s'] for i in cuts] + [L]
        kinds = [None] + [i for i in cuts] + [None]
        for j in range(len(ss) - 1):
            s0, s1 = ss[j], ss[j + 1]
            if s1 - s0 < 0.05:
                continue
            t0, t1 = s0 / L, s1 / L
            p0 = (a[0] + t0 * (b[0] - a[0]), a[1] + t0 * (b[1] - a[1]))
            p1 = (a[0] + t1 * (b[0] - a[0]), a[1] + t1 * (b[1] - a[1]))
            pieces.append(dict(edge=k, p0=p0, p1=p1, start_tick=kinds[j], end_tick=kinds[j + 1],
                               start_node=e['a'] if j == 0 else None,
                               end_node=e['b'] if j == len(ss) - 2 else None))
    return pieces


def group_pieces(pieces, ticks, physical_only: bool):
    """Componentes conexas de tramos; una marca (física, o cualquiera) corta la conexión."""
    parent = list(range(len(pieces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    # dentro de la misma arista: tramos consecutivos separados por una marca virtual si physical_only
    by_edge = defaultdict(list)
    for i, p in enumerate(pieces):
        by_edge[p['edge']].append(i)
    for k, idx in by_edge.items():
        for i, j in zip(idx, idx[1:]):
            tk = pieces[i]['end_tick']
            if tk is not None and physical_only and ticks[tk]['kind'] == 'virtual':
                union(i, j)
    # en los nodos: unir tramos que llegan al nodo (sin marca en el nodo)
    at_node = defaultdict(list)
    for i, p in enumerate(pieces):
        if p['start_node'] is not None and p['start_tick'] is None:
            at_node[p['start_node']].append(i)
        if p['end_node'] is not None and p['end_tick'] is None:
            at_node[p['end_node']].append(i)
    for n, idx in at_node.items():
        for j in idx[1:]:
            union(idx[0], j)
    comps = defaultdict(list)
    for i in range(len(pieces)):
        comps[find(i)].append(i)
    return list(comps.values())


def _line_frame(p0, p1):
    (x0, y0), (x1, y1) = p0, p1
    L = math.hypot(x1 - x0, y1 - y0) or 1e-9
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    if ux < 0 or (abs(ux) < 1e-9 and uy < 0):
        ux, uy = -ux, -uy
    return ux, uy, L


def _rel(px, py, p0, p1):
    """(s, d): posición a lo largo de la recta p0→p1 (orientada hacia +x) y distancia perpendicular
    con signo (>0 = por encima en el dibujo)."""
    ux, uy, L = _line_frame(p0, p1)
    ox, oy = (p0 if (p1[0] - p0[0]) * ux + (p1[1] - p0[1]) * uy >= 0 else p1)
    vx, vy = px - ox, py - oy
    s = vx * ux + vy * uy
    d = -(vx * (-uy) + vy * ux)   # normal hacia arriba de la pantalla = (uy, -ux)
    d = vx * uy - vy * ux
    return s, d, L


def assign_section_labels(pieces, labels: list[Text]):
    """Cada etiqueta (horizontal o girada) se asigna al tramo paralelo más cercano (encima o debajo)."""
    out = {}
    for li, lab in enumerate(labels):
        lx, ly = lab.dir
        best = None
        for i, p in enumerate(pieces):
            ux, uy, L = _line_frame(p['p0'], p['p1'])
            if L < 0.5:
                continue
            if abs(ux * ly - uy * lx) > 0.08:          # no paralelo a la etiqueta
                continue
            s, d, _ = _rel(lab.cx, lab.cy, p['p0'], p['p1'])
            if not (-0.6 <= s <= L + 0.6):
                continue
            if 0.6 <= d <= 5.6:                         # encima
                score = abs(d - 2.0)
            elif -5.4 <= d <= -1.0:                      # debajo
                score = 2.5 + abs(d + 2.6)
            else:
                continue
            if best is None or score < best[0]:
                best = (score, i, s, d)
        if best:
            out[li] = dict(piece=best[1], s=best[2], d=best[3])
    return out


def length_for(lab_info, piece, lengths: list[Text]):
    best = None
    for t in lengths:
        s, d, L = _rel(t.cx, t.cy, piece['p0'], piece['p1'])
        if abs(s - lab_info['s']) > 7 or abs(d) > 6:
            continue
        if lab_info['d'] > 0 and d > lab_info['d'] - 0.8:
            continue
        if lab_info['d'] < 0 and d > lab_info['d'] + 0.2 and d > -0.5:
            pass
        score = abs(s - lab_info['s']) + abs(d - (lab_info['d'] - 4.2 if lab_info['d'] > 0 else lab_info['d'] - 3.0))
        if best is None or score < best[0]:
            best = (score, t)
    if best:
        m = re.match(r'^([\d.]+)m?$', best[1].t)
        if m:
            try:
                return float(m.group(1)), best[1].t
            except ValueError:
                return None, best[1].t
        return None, best[1].t
    return None, None


# ───────────────────────────── señales ─────────────────────────────

def lamp_clusters(page: Page):
    pieces = [f for f in page.fills if f['fill'] in LAMP_COLORS and (f['x1'] - f['x0']) < 4.2
              and (f['y1'] - f['y0']) < 1.0 and AREA[1] <= f['y0'] <= AREA[3]]
    pieces.sort(key=lambda f: (f['fill'], round(f['x0'])))
    clusters = []
    # agrupación por grilla
    grid = defaultdict(list)
    for f in pieces:
        cx = (f['x0'] + f['x1']) / 2
        cy = (f['y0'] + f['y1']) / 2
        grid[(f['fill'], int(cx // 4), int(cy // 4))].append((cx, cy, f))
    seen = set()
    keys = list(grid.keys())
    for key in keys:
        if key in seen:
            continue
        stack = [key]
        members = []
        while stack:
            kk = stack.pop()
            if kk in seen or kk not in grid:
                continue
            seen.add(kk)
            members.extend(grid[kk])
            col, gx, gy = kk
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    stack.append((col, gx + dx, gy + dy))
        # dividir en círculos por separación en x
        members.sort(key=lambda m: m[2]['x0'])
        cur = []
        for m in members:
            if cur and m[2]['x0'] > max(c[2]['x1'] for c in cur) + 0.4:
                clusters.append((key[0], cur))
                cur = []
            cur.append(m)
        if cur:
            clusters.append((key[0], cur))
    out = []
    for col, mem in clusters:
        x0 = min(m[2]['x0'] for m in mem)
        x1 = max(m[2]['x1'] for m in mem)
        y0 = min(m[2]['y0'] for m in mem)
        y1 = max(m[2]['y1'] for m in mem)
        if (x1 - x0) < 2.0 or (y1 - y0) < 2.0:
            continue
        out.append(dict(color=LAMP_COLORS[col], x0=x0, x1=x1, y0=y0, y1=y1, cx=(x0 + x1) / 2, cy=(y0 + y1) / 2))
    return out


def extract_signals(page: Page, g: TrackGraph, head: dict[str, HeaderEntry], track_names):
    lamps = lamp_clusters(page)
    posts = [s for s in page.segs if s.color == BLACK and s.is_vertical(0.05) and 3.0 <= s.length <= 4.3]
    out = []
    labels = [t for t in page.texts if t.horizontal and t.color == '000000' and abs(t.size - 3.47) < 0.05
              and re.match(r'^(S|BS)[0-9A-Z]+$', t.t)]
    for lab in labels:
        near = [l for l in lamps if abs(l['cy'] - lab.cy) < 2.5 and
                (lab.x0 - 22 <= l['cx'] <= lab.x0 + 0.5 or lab.x1 - 0.5 <= l['cx'] <= lab.x1 + 22)]
        if not near:
            out.append(dict(id=lab.t, label=(lab.x0, lab.y0, lab.x1, lab.y1), lamps=[], obs='sin focos detectados'))
            continue
        # quedarse con el grupo contiguo más cercano a la etiqueta
        left = sorted([l for l in near if l['cx'] < lab.cx], key=lambda l: -l['cx'])
        right = sorted([l for l in near if l['cx'] > lab.cx], key=lambda l: l['cx'])
        group = []
        side = None
        for seq, sd in ((left, 'izq'), (right, 'der')):
            gr = []
            edge = lab.x0 if sd == 'izq' else lab.x1
            for l in seq:
                ref = edge if not gr else (gr[-1]['x0'] if sd == 'izq' else gr[-1]['x1'])
                gap = (ref - l['x1']) if sd == 'izq' else (l['x0'] - ref)
                if gap > 4.5:
                    break
                gr.append(l)
            if len(gr) > len(group):
                group, side = gr, sd
        gx0 = min(l['x0'] for l in group)
        gx1 = max(l['x1'] for l in group)
        gcy = sum(l['cy'] for l in group) / len(group)
        pst = [s for s in posts if abs((s.y0 + s.y1) / 2 - gcy) < 1.0 and
               (gx0 - 1.6 <= s.x0 <= gx0 + 0.25 or gx1 - 0.25 <= s.x0 <= gx1 + 1.6)]
        # descartar trazos interiores de foco
        post_x = None
        sentido = None
        if pst:
            px = min(pst, key=lambda s: min(abs(s.x0 - gx0), abs(s.x0 - gx1))).x0
            post_x = px
            sentido = 'PAN' if (gx0 + gx1) / 2 > px else 'OBS'   # x crece hacia Pantitlán
        lamp_order = sorted(group, key=lambda l: abs(l['cx'] - (post_x if post_x is not None else gx0)))
        # vía asociada: arista horizontal más cercana en vertical
        best = None
        xref = post_x if post_x is not None else (gx0 + gx1) / 2
        for k, e in enumerate(g.edges):
            x0, x1 = edge_xrange(e)
            if not (x0 - 0.5 <= xref <= x1 + 0.5):
                continue
            (a, b) = e['pts']
            if abs(b[1] - a[1]) > 0.5:
                continue
            dy = edge_y_at(e, xref) - gcy
            if abs(dy) < 16 and (best is None or abs(dy) < abs(best[0])):
                best = (dy, k)
        h = head.get(lab.t)
        sig = dict(
            id=lab.t,
            tipo='fin_de_via' if lab.t.startswith('BS') else 'principal',
            estacion=station_of(lab.t),
            focos=[l['color'] for l in lamp_order],
            sentido=sentido,
            x=r2(xref),
            y=r2(edge_y_at(g.edges[best[1]], xref)) if best else r2(gcy),
            lado='arriba' if best and best[0] > 0 else ('abajo' if best else None),
            via=track_names.get(best[1]) if best else None,
            edge=best[1] if best else None,
            head=dict(x0=r2(gx0), x1=r2(gx1), cy=r2(gcy)),
            etiqueta=dict(x=r2(lab.x0), y=r2(lab.y1)),
            pk=r3(h.pk_best) if h else None,
            pk_texto=h.pk_text if h else None,
        )
        if sentido is None:
            sig['obs'] = 'no se identificó el poste del símbolo (sentido indeterminado)'
        if best is None:
            sig['obs'] = (sig.get('obs', '') + '; sin vía asociada').strip('; ')
        out.append(sig)
    # etiquetas giradas (enlaces con L3 y taller): sin símbolo legible → posición de la etiqueta
    for lab in page.texts:
        if lab.horizontal or lab.vertical or lab.color != '000000' or abs(lab.size - 3.47) > 0.05:
            continue
        if not re.match(r'^(S|BS)[0-9A-Z]+$', lab.t) or any(s['id'] == lab.t for s in out):
            continue
        d, k, t = nearest_edge(g, lab.cx, lab.cy, maxd=25)
        h = head.get(lab.t)
        out.append(dict(id=lab.t, tipo='principal', estacion=station_of(lab.t), focos=[], sentido=None,
                        x=r2(lab.cx), y=r2(lab.cy), lado=None, via=track_names.get(k) if k is not None else None,
                        edge=k, head=None, etiqueta=dict(x=r2(lab.x0), y=r2(lab.y1)),
                        pk=r3(h.pk_best) if h else None, pk_texto=h.pk_text if h else None,
                        obs='símbolo girado en el plano: posición aproximada, sentido no determinado'))
    return out


# ───────────────────────────── agujas ─────────────────────────────

def extract_switches(page: Page, g: TrackGraph, head: dict[str, HeaderEntry], track_names, sections, pieces):
    """Una aguja por sección 'A…': el nodo de grado 3 donde concurren los tramos de la sección."""
    deg = g.degree()
    inc = defaultdict(list)
    for k, e in enumerate(g.edges):
        inc[e['a']].append(k)
        inc[e['b']].append(k)
    black_labels = {t.t: t for t in page.texts if t.color == '000000' and abs(t.size - 2.97) < 0.05
                    and not t.vertical and re.match(r'^A[0-9A-Z]+$', t.t)}
    used = set()
    out = []

    def vec(k, n):
        e = g.edges[k]
        o = e['b'] if e['a'] == n else e['a']
        (x0, y0), (x1, y1) = g.nodes[n], g.nodes[o]
        L = math.hypot(x1 - x0, y1 - y0) or 1
        return ((x1 - x0) / L, (y1 - y0) / L)

    for s in sorted(sections, key=lambda s: s['id']):
        sid = s['id']
        if not sid.startswith('A'):
            continue
        sec_edges = {pieces[i]['edge'] for i in s['comp']}
        cands = []
        for n, d in deg.items():
            if d != 3 or n in used:
                continue
            hits = sum(1 for k in inc[n] if k in sec_edges)
            if hits >= 2:
                cands.append(n)
        lab = black_labels.get(sid)
        ref = (lab.cx, lab.cy) if lab else ((s['etiqueta']['x'], s['etiqueta']['y']) if s.get('etiqueta') else None)
        if not cands:
            out.append(dict(id=sid, estacion=station_of(sid), obs='no se identificó el nodo de aguja dentro de la sección'))
            continue
        n = min(cands, key=lambda n: math.dist(g.nodes[n], ref) if ref else 0)
        used.add(n)
        ks = inc[n]
        vs = {k: vec(k, n) for k in ks}
        trunk = None
        for k in ks:
            others = [j for j in ks if j != k]
            if all(vs[k][0] * vs[j][0] + vs[k][1] * vs[j][1] < 0 for j in others):
                trunk = k
        if trunk is None:
            trunk = max(ks, key=lambda k: -sum(vs[k][0] * vs[j][0] + vs[k][1] * vs[j][1] for j in ks if j != k))
        branches = [j for j in ks if j != trunk]
        straight = max(branches, key=lambda j: -(vs[trunk][0] * vs[j][0] + vs[trunk][1] * vs[j][1]))
        diverging = [j for j in branches if j != straight][0]
        h = head.get(sid)
        x, y = g.nodes[n]
        out.append(dict(
            id=sid, estacion=station_of(sid), x=r2(x), y=r2(y), nodo=n,
            via=track_names.get(trunk),
            talon_edge=trunk, recta_edge=straight, desviada_edge=diverging,
            via_recta=track_names.get(straight), via_desviada=track_names.get(diverging),
            normal='recta',
            pk=r3(h.pk) if h else None, pk_texto=h.pk_text if h else None,
            pk_desviada_local=r3(h.pk_aux) if h else None,
            etiqueta=dict(x=r2(lab.x0), y=r2(lab.y1)) if lab else None,
        ))
    return out


# ───────────────────────────── andenes y estaciones ─────────────────────────────

def extract_platforms(page: Page, g: TrackGraph, track_names, header_list: list[HeaderEntry]):
    lines = [s for s in page.segs if s.color == BLACK and s.width == 0 and s.is_horizontal() and s.length > 40
             and AREA[1] <= s.y0 <= AREA[3]]
    # deduplicar
    uniq = {}
    for s in lines:
        key = (round(min(s.x0, s.x1)), round(max(s.x0, s.x1)), round(s.y0, 1))
        uniq[key] = s
    texts = page.texts
    out = []
    for (x0, x1, y), s in sorted(uniq.items()):
        # vía del andén: arista horizontal más cercana
        cx = (x0 + x1) / 2
        best = None
        for k, e in enumerate(g.edges):
            ex0, ex1 = edge_xrange(e)
            if not (ex0 - 1 <= cx <= ex1 + 1):
                continue
            (a, b) = e['pts']
            if abs(b[1] - a[1]) > 0.5:
                continue
            dy = edge_y_at(e, cx) - y
            if abs(dy) < 25 and (best is None or abs(dy) < abs(best[0])):
                best = (dy, k)
        if best is None:
            continue
        side = 1 if best[0] < 0 else -1   # +1: andén debajo de la vía
        box = [t for t in texts if x0 - 2 <= t.cx <= x1 + 2 and t.horizontal and (
            (side < 0 and y - 32 <= t.cy <= y + 3.5) or (side > 0 and y - 3.5 <= t.cy <= y + 32))]

        def nearest(pred):
            c = [t for t in box if pred(t)]
            return min(c, key=lambda t: abs(t.cy - y)) if c else None

        tmx = nearest(lambda t: re.match(r'^MX\d{3}$', t.t))
        tpl = nearest(lambda t: t.t.startswith('PLATFORM'))
        tpk = nearest(lambda t: t.t.startswith('PK ') and 'ABS' not in t.t)
        tcode = nearest(lambda t: re.match(r'^\((\w{3})\)$', t.t))
        mx = tmx.t if tmx else None
        plat = tpl.t if tpl else None
        pkc = tpk.t if tpk else None
        code = re.sub(r'[()]', '', tcode.t) if tcode else None
        bfus = sorted(set(t.t.replace(' ', '') for t in box if t.t.startswith('BFU') and abs(t.cy - y) < 13))
        oc = [t.t for t in box if t.t in ('OC', 'ZC', 'WCU')]
        via = track_names.get(best[1])
        ids = set()
        if code:
            if via and re.match(r'^V\d+$', via):
                ids.add(code + via[1:])
            if plat:
                mnum = re.search(r'(\d+)$', plat)
                if mnum:
                    ids.add(code + mnum.group(1))
            for b in bfus:
                mb = re.match(r'^BFU(\d+)', b)
                if mb and len(mb.group(1)) == 2:
                    ids.add(code + mb.group(1))
        out.append(dict(
            ids=sorted(ids),
            estacion=code, mx=mx, plataforma=plat, via=via,
            x0=r2(x0), x1=r2(x1), y_borde=r2(y), y_via=r2(edge_y_at(g.edges[best[1]], cx)),
            lado='arriba' if side < 0 else 'abajo', pk_centro=r3(parse_pk(pkc[3:])) if pkc else None,
            pk_centro_texto=pkc, bfu=bfus, equipos=sorted(set(oc)),
        ))
    return out


# ───────────────────────────── balizas, PSP, FP, AVC, topes ─────────────────────────────

def extract_balises(page: Page, g: TrackGraph):
    labels = [t for t in page.texts if t.horizontal and re.match(r'^\*?BA\d{5,6}$', t.t)]
    vert = [t for t in page.texts if not t.horizontal]
    pkspans = [t for t in vert if re.match(r'^-?\d+\+\d', t.t)]
    names = defaultdict(list)
    for t in vert:
        if re.match(r'^\*?BA\d{5,6}$', t.t):
            names[t.t].append(t)
    tris = [f for f in page.fills if f['fill'] == BLACK and 2.5 < (f['x1'] - f['x0']) < 3.3
            and 1.0 < (f['y1'] - f['y0']) < 1.8]
    out = []
    for lab in labels:
        pk = None
        pkt = None
        for v in names.get(lab.t, []):
            near = [p for p in pkspans if abs(p.cx - v.cx) < 0.6 or (abs(p.cy - v.cy) < 0.6 and abs(p.cx - v.cx) < 1.8)]
            near = [p for p in pkspans if abs(p.cx - v.cx) < 1.8 and abs(p.cy - v.cy) < 20]
            if near:
                p = min(near, key=lambda p: abs(p.cx - v.cx) + abs(p.cy - v.cy) * 0.01)
                pkt = p.t
                pk = parse_pk(p.t)
                break
        tri = [f for f in tris if abs((f['x0'] + f['x1']) / 2 - lab.cx) < 6 and abs(f['y0'] - lab.y1) < 3.2]
        if tri:
            f = min(tri, key=lambda f: abs((f['x0'] + f['x1']) / 2 - lab.cx))
            bx = (f['x0'] + f['x1']) / 2
            by = f['y1']
        else:
            bx, by = lab.cx, lab.y1 + 1.5
        d, k, t = nearest_edge(g, bx, by + 1.5, maxd=6)
        if k is not None:
            by = edge_y_at(g.edges[k], bx)
        out.append(dict(id=lab.t.lstrip('*'), provisional=lab.t.startswith('*'), x=r2(bx), y=r2(by),
                        pk=r3(pk), pk_texto=pkt, edge=k))
    return out


def extract_markers(page: Page, g: TrackGraph, header_list: list[HeaderEntry]):
    """PSP, marcadores 'AL <señal>' y puntos de libramiento (FP)."""
    psp = []
    al = []
    fp = []
    head_psp = [h for h in header_list if 'PSP' in h.name]
    for t in page.texts:
        if not t.horizontal:
            continue
        if t.t == 'PSP' or t.t.startswith('PSP*'):
            d, k, tt = nearest_edge(g, t.cx, t.y1 + 2.5, maxd=5)
            if k is None:
                continue
            y = edge_y_at(g.edges[k], t.cx)
            hs = [h for h in head_psp if abs(h.x - t.cx) < 9]
            psp.append(dict(x=r2(t.cx), y=r2(y), edge=k, pk_candidatos=[r3(h.pk_best) for h in hs]))
        m = re.match(r'^AL ((?:S|BS)[0-9A-Z]+)$', t.t)
        if m:
            # la flecha apunta a la vía (desde arriba o abajo)
            up = nearest_edge(g, t.cx, t.y1 + 3.0, maxd=4)
            dn = nearest_edge(g, t.cx, t.y0 - 3.0, maxd=4)
            cand = [c for c in (up, dn) if c[1] is not None]
            if not cand:
                continue
            d, k, tt = min(cand, key=lambda c: c[0])
            al.append(dict(senal=m.group(1), x=r2(t.cx), y=r2(edge_y_at(g.edges[k], t.cx)), edge=k))
        m = re.match(r'^FP (A[0-9A-Z]+)$', t.t)
        if m and t.color == 'ff0000' and abs(t.size - 2.48) < 0.05:
            hs = [h for h in header_list if h.name == t.t]
            fp.append(dict(aguja=m.group(1), x=r2(t.cx), y=r2(t.cy),
                           pk=r3(hs[0].pk_best) if hs else None))
    return psp, al, fp


def extract_avc(page: Page, g: TrackGraph, header_list: list[HeaderEntry]):
    out = []
    labs = [t for t in page.texts if t.horizontal and t.color == '0000ff' and t.t.startswith('AVC')]
    for lab in labs:
        name = lab.t.rstrip('*')
        hs = [h for h in header_list if h.name.rstrip('*').endswith(name) or h.name.rstrip('*') == name
              or re.sub(r'^\(V\w+\)', '', h.name).rstrip('*') == name]
        pks = sorted(h.pk_best for h in hs if h.pk_best is not None)
        alias = {'AVC20BPIN': ['AVC20PIN']}.get(name, [])
        out.append(dict(id=name, alias=alias, provisional=lab.t.endswith('*'), x=r2(lab.cx), y=r2(lab.cy),
                        pk_ini=r3(pks[0]) if pks else None, pk_fin=r3(pks[-1]) if pks else None,
                        tgmt_id=AVC_TGMT.get(name)))
    return out


def extract_buffer_stops(page: Page, g: TrackGraph):
    deg = g.degree()
    ends = [n for n, d in deg.items() if d == 1]
    out = []
    for t in page.texts:
        if t.horizontal and re.match(r'^TOP[0-9A-Z]+$', t.t):
            cands = [(math.hypot(g.nodes[n][0] - t.cx, g.nodes[n][1] - t.cy), n) for n in ends]
            cands = [c for c in cands if c[0] < 20]
            if cands:
                d, n = min(cands)
                out.append(dict(id=t.t, x=r2(g.nodes[n][0]), y=r2(g.nodes[n][1]), nodo=n))
            else:
                out.append(dict(id=t.t, x=r2(t.cx), y=r2(t.cy), nodo=None, obs='sin extremo de vía cercano'))
    return out


def extract_limits(page: Page, texts: list[Text]):
    """Líneas verticales discontinuas rojas (límite entre estaciones) y magenta (límite WCU)."""
    groups = defaultdict(list)
    for s in page.segs:
        if s.color in (RED, (1.0, 0.0, 1.0)) and abs(s.width - 0.24) < 0.01 and s.is_vertical(0.02) and 1.5 < s.length < 8:
            groups[(s.color, round(s.x0 * 2) / 2)].append(s)
    out = []
    for (col, x), segs in sorted(groups.items(), key=lambda kv: kv[0][1]):
        if len(segs) < 8:
            continue
        y0 = min(min(s.y0, s.y1) for s in segs)
        y1 = max(max(s.y0, s.y1) for s in segs)
        if y1 - y0 < 80:
            continue
        near = [t for t in texts if t.vertical and abs(t.cx - x) < 8 and not re.match(r'^-?\d+\+', t.t)
                and not t.t.startswith('(') and t.color == '000000' and 130 < t.cy < 260]
        izq = [t.t for t in near if t.cx < x]
        der = [t.t for t in near if t.cx > x]
        out.append(dict(x=r2(x), y0=r2(y0), y1=r2(y1), tipo='wcu' if col != RED else 'estacion',
                        izq=izq[0] if izq else None, der=der[0] if der else None))
    return out


# ───────────────────────────── plano de CDV (bifilar) ─────────────────────────────

FREQ_RE = re.compile(r'^F(\d+)\(([\d,]+)\s*[kK][hH]z\)$')


def read_cdv_plan(path: str):
    p = load_page(path, 0)
    green = [t for t in p.texts if t.color == '00cc00' and not t.vertical]
    names = [t for t in green if re.match(r'^C[0-9Z][0-9A-Z]*$', t.t) and station_of(t.t)]
    attrs = {n.t: dict(tipo=None, frecuencia=None, x=r2(n.cx), y=r2(n.cy)) for n in names}
    toks = [t for t in green if t.t in ('ST', 'MI', 'PO') or FREQ_RE.match(t.t) or re.match(r'^ST\(F[\d,]+KHz\)$', t.t)]
    best_for = {}
    for t in toks:
        best = None
        for n in names:
            ux, uy = n.dir
            if abs(t.dir[0] - ux) > 0.05 or abs(t.dir[1] - uy) > 0.05:
                continue
            vx, vy = t.cx - n.cx, t.cy - n.cy
            along = vx * ux + vy * uy
            perp = vx * uy - vy * ux
            if not (-14 < along < 40 and abs(perp) < 3.8):
                continue
            cost = abs(along) * 0.35 + abs(perp) * 2.0
            if best is None or cost < best[0]:
                best = (cost, n.t)
        if best is None:
            continue
        kind = 'tipo' if t.t in ('ST', 'MI', 'PO') else 'frecuencia'
        key = (best[1], kind)
        if key not in best_for or best[0] < best_for[key][0]:
            best_for[key] = (best[0], t)
        if t.t.startswith('ST('):
            key2 = (best[1], 'tipo')
            if key2 not in best_for or best[0] < best_for[key2][0]:
                best_for[key2] = (best[0], t)
    for (name, kind), (_, t) in best_for.items():
        if kind == 'tipo':
            attrs[name]['tipo'] = 'ST' if t.t.startswith('ST') else t.t
        else:
            m = FREQ_RE.match(t.t)
            if m:
                attrs[name]['frecuencia'] = dict(codigo='F' + m.group(1), khz=float(m.group(2).replace(',', '.')))
            else:
                m2 = re.match(r'^ST\(F([\d,]+)KHz\)$', t.t)
                attrs[name]['frecuencia'] = dict(codigo=None, khz=float(m2.group(1).replace(',', '.')), texto=t.t)
    head = read_header(p.texts)
    joints = []
    for h in head:
        m = re.match(r'^\((V[0-9A-Z]+|L\d)\)(LS|LC|LT|AC|JAR|J)$', h.name)
        if m and h.pk is not None:
            joints.append(dict(via=m.group(1), tipo=m.group(2), pk=h.pk, x=h.x))
        m = re.match(r'^JAR (\w+)$', h.name)
        if m and h.pk is not None:
            joints.append(dict(via=None, tipo='JAR', ref=m.group(1), pk=h.pk, x=h.x))
    subst = []
    for t in p.texts:
        m = re.match(r'^S/E\s+(.+)$', t.t)
        if m and t.horizontal:
            subst.append(dict(nombre=m.group(1).strip(), x=r2(t.cx)))
    # PK de subestaciones: texto 'S/E ... <pk>' en el contenido extraído por línea
    return dict(cdv=attrs, juntas=joints, subestaciones=subst, header=head, page=p)


def title_block(page: Page, code_re: str):
    """Revisión vigente y tabla de modificaciones del cajetín."""
    txt = [t.t for t in page.texts]
    return txt


# ───────────────────────────── principal ─────────────────────────────

def build(senal_pdf: str, cdv_pdf: str):
    page = load_page(senal_pdf, 0)
    g = build_track_graph(page.segs, AREA)
    track_names = name_tracks(g, page.texts)
    header_list = read_header(page.texts)
    head: dict[str, HeaderEntry] = {}
    for h in header_list:
        head.setdefault(h.name, h)

    # marcas y tramos
    raw_lines = merge_collinear(chain_dashes(merge_collinear([_norm(s) for s in page.segs if is_track_candidate(s, AREA)])))
    ticks = find_ticks(page.segs, g, raw_lines)
    pieces = split_pieces(g, ticks)
    sec_comps = group_pieces(pieces, ticks, physical_only=False)
    cdv_comps = group_pieces(pieces, ticks, physical_only=True)

    gray_labels = [t for t in page.texts if t.color == '494949' and abs(t.size - 2.48) < 0.05]
    gray_lengths = [t for t in page.texts if t.color == '494949' and abs(t.size - 1.98) < 0.05]
    green_labels = [t for t in page.texts if t.color == '00cc00' and abs(t.size - 2.97) < 0.05
                    and re.match(r'^C', t.t) and not t.vertical]

    observ = []
    piece_section = {}
    sections = []
    used_labels = set()
    lab_piece = assign_section_labels(pieces, gray_labels)
    piece_labels = defaultdict(list)
    for li, info in lab_piece.items():
        piece_labels[info['piece']].append(li)
    for comp in sec_comps:
        cands = [(0, li) for i in comp for li in piece_labels.get(i, [])]
        names = []
        for dy, li in cands:
            if gray_labels[li].t not in names:
                names.append(gray_labels[li].t)
        total_pt = sum(math.dist(pieces[i]['p0'], pieces[i]['p1']) for i in comp)
        if not names:
            if total_pt > 3:
                observ.append(dict(tipo='seccion_sin_nombre', detalle='Tramo de vía sin etiqueta de sección',
                                   x=r2(min(min(pieces[i]['p0'][0], pieces[i]['p1'][0]) for i in comp)),
                                   y=r2(pieces[comp[0]]['p0'][1]), largo_pt=r2(total_pt)))
            sid = None
        else:
            sid = names[0]
            if len(names) > 1:
                observ.append(dict(tipo='seccion_multiple_etiqueta',
                                   detalle=f'Tramo continuo (sin marca de límite detectada) con varias etiquetas: {", ".join(names)}; se usa {names[0]}'))
        lab_i = next((li for dy, li in cands if gray_labels[li].t == sid), None) if sid else None
        lab = gray_labels[lab_i] if lab_i is not None else None
        length, length_txt = (length_for(lab_piece[lab_i], pieces[lab_piece[lab_i]['piece']], gray_lengths)
                              if lab_i is not None else (None, None))
        for i in comp:
            piece_section[i] = sid
        if sid:
            used_labels.add(sid)
            sections.append(dict(id=sid, comp=comp, longitud_m=length, longitud_texto=length_txt,
                                 etiqueta=dict(x=r2(lab.x0), y=r2(lab.y1)) if lab else None))
    # una misma sección puede aparecer partida en varios componentes (p. ej. cortada por un nodo con marca)
    sec_by_id = {}
    for s in sections:
        if s['id'] in sec_by_id:
            sec_by_id[s['id']]['comp'].extend(s['comp'])
        else:
            sec_by_id[s['id']] = s
    sections = list(sec_by_id.values())
    labels_all = {t.t for t in gray_labels}
    for missing in sorted(labels_all - set(sec_by_id)):
        observ.append(dict(tipo='etiqueta_sin_tramo', detalle=f'Etiqueta de sección {missing} sin tramo de vía asociado'))

    # CDV físicos (componentes cortados sólo por juntas físicas)
    cdv_plan = read_cdv_plan(cdv_pdf)
    plan_names = set(cdv_plan['cdv'])
    cdvs = []
    piece_cdv = {}
    used_green = set()
    comp_info = []
    for comp in cdv_comps:
        secs = []
        for i in comp:
            sid = piece_section.get(i)
            if sid and sid not in secs:
                secs.append(sid)
        parents = []
        for sid in secs:
            if sid.startswith('C'):
                par = re.sub(r'\d$', '', sid)
                if par not in parents:
                    parents.append(par)
        comp_info.append(dict(comp=comp, secs=secs, parents=parents))

    def greens_in(comp):
        xs = [p for i in comp for p in (pieces[i]['p0'], pieces[i]['p1'])]
        cx0, cx1 = min(p[0] for p in xs), max(p[0] for p in xs)
        out = []
        for gi, t in enumerate(green_labels):
            if not (cx0 - 1 <= t.cx <= cx1 + 1):
                continue
            ds = [abs(edge_y_at(g.edges[pieces[i]['edge']], t.cx) - t.cy) for i in comp
                  if edge_xrange(g.edges[pieces[i]['edge']])[0] - 1 <= t.cx <= edge_xrange(g.edges[pieces[i]['edge']])[1] + 1]
            if ds and min(ds) < 9:
                out.append((min(ds), gi))
        return out

    # 1) componentes con secciones virtuales C…: el nombre del CDV es el prefijo común
    for ci in comp_info:
        if not ci['parents']:
            continue
        cid = ci['parents'][0]
        if len(ci['parents']) > 1:
            observ.append(dict(tipo='cdv_varios_padres',
                               detalle=f'No se detectó junta física entre {", ".join(ci["parents"])}; se agrupan bajo {cid}'))
        ci['cid'] = cid
    taken = {ci['cid'] for ci in comp_info if ci.get('cid')}
    # 2) componentes sólo con secciones de aguja: etiqueta verde (preferencia por nombre homólogo)
    for ci in comp_info:
        if ci.get('cid'):
            continue
        wanted = []
        for sid in ci['secs']:
            wanted.append('C' + sid[1:])
            m = re.match(rf'^A(\d+)[A-Z]({STATION_RE})$', sid)
            if m:
                wanted.append(f'C{m.group(1)}{m.group(2)}')
            m = re.match(rf'^AZ([AB])\d({STATION_RE})$', sid)
            if m:
                wanted.append(f'CZ{m.group(1)}{m.group(2)}')
        ordered = sorted(greens_in(ci['comp']), key=lambda q: (green_labels[q[1]].t not in wanted, q[0]))
        for dmin, gi in ordered:
            nm = green_labels[gi].t
            if gi not in used_green and nm not in taken:
                ci['cid'] = nm
                used_green.add(gi)
                taken.add(nm)
                break
    # 3) nombres distintos entre planos (mismo número y estación) → alias
    aliases = {}
    unassigned_plan = sorted(plan_names - taken)
    for ci in comp_info:
        cid = ci.get('cid')
        if not cid or cid in plan_names:
            continue
        m = re.match(rf'^C(\d+)[A-Z]?({STATION_RE}|TZA)$', cid)
        if not m:
            continue
        cands = [u for u in unassigned_plan if re.match(rf'^C{m.group(1)}[A-Z]?{m.group(2)}$', u)]
        if len(cands) == 1:
            aliases[cid] = cands[0]
            unassigned_plan.remove(cands[0])
            observ.append(dict(tipo='nombre_distinto_entre_planos',
                               detalle=f'El CDV {cid} de la tira de señalización se identifica como {cands[0]} en el plano de circuitos de vía'))
    # 4) componentes de aguja sin nombre: único CDV del plano bifilar sin ubicar en la misma estación
    for ci in comp_info:
        if ci.get('cid') or not ci['secs']:
            continue
        st = station_of(ci['secs'][0])
        cands = [u for u in unassigned_plan if station_of(u) == st]
        if len(cands) == 1:
            ci['cid'] = cands[0]
            ci['inferido'] = True
            unassigned_plan.remove(cands[0])
            observ.append(dict(tipo='cdv_nombre_inferido',
                               detalle=f'El tramo con secciones {", ".join(ci["secs"])} no tiene etiqueta de CDV propia en la tira; '
                                       f'se le asigna {cands[0]} (único CDV de {st} del plano bifilar sin ubicar)'))
        else:
            observ.append(dict(tipo='cdv_sin_nombre', detalle=f'CDV físico sin etiqueta para secciones {", ".join(ci["secs"])}'))
    for ci in comp_info:
        cid = ci.get('cid')
        if not cid:
            continue
        for i in ci['comp']:
            piece_cdv[i] = cid
        cdvs.append(dict(id=cid, comp=ci['comp'], secciones=ci['secs'], inferido=ci.get('inferido', False)))
    # fusionar CDV repetidos
    cdv_by_id = {}
    for c in cdvs:
        if c['id'] in cdv_by_id:
            cdv_by_id[c['id']]['comp'].extend(c['comp'])
            for s in c['secciones']:
                if s not in cdv_by_id[c['id']]['secciones']:
                    cdv_by_id[c['id']]['secciones'].append(s)
        else:
            cdv_by_id[c['id']] = c

    # juntas físicas: PK desde el encabezado ("(Vx)J")
    head_joints = [h for h in header_list if re.match(r'^\((V[0-9A-Z]+|L\d|V\d-V?\d|V[0-9A-Z]+-V[0-9A-Z]+)\)J$', h.name) or h.name == 'J']
    for tk in ticks:
        tk['via'] = track_names.get(tk['edge'])
    phys = [tk for tk in ticks if tk['kind'] == 'fisica']
    # asignación por vía y cercanía en x, respetando orden
    by_via = defaultdict(list)
    for h in head_joints:
        m = re.match(r'^\(([^)]*)\)J$', h.name)
        by_via[m.group(1) if m else ''].append(h)
    for tk in phys:
        via = tk['via'] or ''
        cands = [h for h in by_via.get(via, []) if abs(h.x - tk['x']) < 10]
        if not cands and '/' in via:
            cands = [h for vv, hs in by_via.items() if '-' in vv for h in hs if abs(h.x - tk['x']) < 10]
        if not cands:
            cands = [h for hs in by_via.values() for h in hs if abs(h.x - tk['x']) < 5]
        if cands:
            h = min(cands, key=lambda h: abs(h.x - tk['x']))
            tk['pk'] = h.pk_best
            tk['pk_texto'] = h.pk_text
            tk['ref_encabezado'] = h.name
    # tipo de junta según plano de CDV (por vía y PK)
    for tk in phys:
        if tk.get('pk') is None:
            continue
        via = tk['via']
        cands = [j for j in cdv_plan['juntas'] if j['via'] == via and abs(j['pk'] - tk['pk']) < 1.6]
        if not cands:
            # el plano de CDV nombra distinto algunas vías de terminal (p. ej. VC/VD de OBS como V1/V2):
            # se acepta la coincidencia por PK si todas las juntas a ±1,6 m son de una misma vía
            near = [j for j in cdv_plan['juntas'] if j.get('via') and abs(j['pk'] - tk['pk']) < 1.6]
            if near and len({j['via'] for j in near}) == 1:
                cands = near
                tk['via_cdv'] = near[0]['via']
        if cands:
            j = min(cands, key=lambda j: abs(j['pk'] - tk['pk']))
            tk['tipo_cdv'] = j['tipo']
            tipos = sorted({c['tipo'] for c in cands})
            if len(tipos) > 1:
                tk['tipos_cdv'] = tipos

    signals = extract_signals(page, g, head, track_names)
    switches = extract_switches(page, g, head, track_names, sections, pieces)
    platforms = extract_platforms(page, g, track_names, header_list)
    balises = extract_balises(page, g)
    psp, al, fp = extract_markers(page, g, header_list)
    avc = extract_avc(page, g, header_list)
    topes = extract_buffer_stops(page, g)
    limits = extract_limits(page, page.texts)

    def nearest_station(x):
        best = None
        for code, *_ in STATIONS:
            xs = [v for p in platforms if p['estacion'] == code for v in (p['x0'], p['x1'])]
            if xs:
                d = abs((min(xs) + max(xs)) / 2 - x)
                if best is None or d < best[0]:
                    best = (d, code)
        return best[1] if best else None

    # El tramo corto entre el tope y la señal de fin de vía (BS) no lleva sección en el plano: no es un hallazgo.
    def junto_a_tope(o):
        return any(abs(t['y'] - o['y']) < 1.0 and abs(t['x'] - o['x']) <= o['largo_pt'] + 3 for t in topes)
    observ = [o for o in observ
              if not (o['tipo'] == 'seccion_sin_nombre' and o['largo_pt'] < 15 and junto_a_tope(o))]
    for o in observ:
        if o['tipo'] == 'seccion_sin_nombre':
            st = nearest_station(o['x'])
            o['detalle'] = (f'Tramo de vía de {o["largo_pt"]} pt sin etiqueta de sección'
                            + (f' (zona {st})' if st else ''))
    for sg in signals:
        if sg.get('obs'):
            observ.append(dict(tipo='senal_posicion_aproximada', x=sg['x'], y=sg['y'],
                               detalle=f'Señal {sg["id"]}: {sg["obs"]}'))
    observ.append(dict(tipo='aguja_normal_asumida',
                       detalle='La posición normal de las 47 agujas se asume en la rama recta: la tira no la indica; '
                               'confirmar con las tablas de enclavamiento'))

    # ── armar salida ──
    def piece_out(i):
        p = pieces[i]
        return [r2(p['p0'][0]), r2(p['p0'][1]), r2(p['p1'][0]), r2(p['p1'][1])]

    sec_out = []
    for s in sorted(sections, key=lambda s: s['id']):
        cid = None
        for i in s['comp']:
            if piece_cdv.get(i):
                cid = piece_cdv[i]
                break
        vias = sorted({track_names.get(pieces[i]['edge']) for i in s['comp']})
        sec_out.append(dict(
            id=s['id'], tipo='aguja' if s['id'].startswith('A') else 'virtual', cdv=cid,
            estacion=station_of(s['id']), vias=vias, longitud_m=s['longitud_m'],
            tramos=[piece_out(i) for i in sorted(s['comp'])], etiqueta=s['etiqueta'],
        ))
    cdv_out = []
    for cid, c in sorted(cdv_by_id.items()):
        alias = aliases.get(cid)
        at = cdv_plan['cdv'].get(cid) or (cdv_plan['cdv'].get(alias) if alias else None)
        vias = sorted({track_names.get(pieces[i]['edge']) for i in c['comp']})
        # PK extremos: juntas físicas en los bordes del componente
        tk_idx = set()
        for i in c['comp']:
            for key in ('start_tick', 'end_tick'):
                ti = pieces[i][key]
                if ti is not None and ticks[ti]['kind'] == 'fisica':
                    tk_idx.add(ti)
        pks = sorted(ticks[ti]['pk'] for ti in tk_idx if ticks[ti].get('pk') is not None)
        lsum = sum(s['longitud_m'] or 0 for s in sections if s['id'] in c['secciones'])
        cdv_out.append(dict(
            id=cid, alias=[alias] if alias else [], nombre_inferido=c.get('inferido', False),
            estacion=station_of(cid), vias=vias, secciones=c['secciones'],
            tipo=at['tipo'] if at else None, frecuencia=at['frecuencia'] if at else None,
            en_plano_cdv=bool(at), pk_juntas=[r3(v) for v in pks],
            longitud_secciones_m=r3(lsum) if lsum else None,
            tramos=[piece_out(i) for i in sorted(c['comp'])],
        ))
    # CDV del plano bifilar que no aparecen en la tira de señalización
    alias_targets = set(aliases.values())
    for cid, at in sorted(cdv_plan['cdv'].items()):
        if cid not in cdv_by_id and cid not in alias_targets:
            observ.append(dict(tipo='cdv_solo_en_plano_cdv',
                               detalle=f'{cid} figura en el plano de circuitos de vía pero no se ubicó en la tira de señalización'))
    for cid in sorted(cdv_by_id):
        if cid not in cdv_plan['cdv'] and cid not in aliases:
            observ.append(dict(tipo='cdv_no_en_plano_cdv',
                               detalle=f'{cid} figura en la tira de señalización pero no en el plano de circuitos de vía'))
    juntas_out = []
    for tk in ticks:
        juntas_out.append(dict(tipo=tk['kind'], x=r2(tk['x']), y=r2(tk['y']), via=tk.get('via'),
                               pk=r3(tk.get('pk')), pk_texto=tk.get('pk_texto'), tipo_cdv=tk.get('tipo_cdv')))
        if tk.get('tipos_cdv'):
            juntas_out[-1]['tipos_cdv'] = tk['tipos_cdv']
        if tk.get('via_cdv'):
            juntas_out[-1]['via_cdv'] = tk['via_cdv']
    vias_out = []
    for k, e in enumerate(g.edges):
        (a, b) = e['pts']
        vias_out.append(dict(id=k, via=track_names.get(k), pts=[r2(a[0]), r2(a[1]), r2(b[0]), r2(b[1])],
                             a=e['a'], b=e['b']))

    # eje de PK (vía 1 / vía 2) para escala superior
    pk_axis = []
    for tk in ticks:
        if tk['kind'] == 'fisica' and tk.get('pk') is not None and tk['via'] in ('V1', 'V2'):
            pk_axis.append([r2(tk['x']), r3(tk['pk']), tk['via']])
    pk_axis.sort()

    stations_out = []
    for code, name, mx in STATIONS:
        pl = [p for p in platforms if p['estacion'] == code]
        xs = [v for p in pl for v in (p['x0'], p['x1'])]
        stations_out.append(dict(codigo=code, nombre=name, tgmt_id=mx, mx=f'MX{mx}',
                                 x=r2((min(xs) + max(xs)) / 2) if xs else None,
                                 andenes=len(pl)))

    return dict(
        lienzo=dict(ancho=page.width, alto=page.height, area=list(AREA),
                    nota='Coordenadas en puntos PDF de la hoja 1/25 del plano de señalización (x crece hacia Pantitlán).'),
        estaciones=stations_out,
        vias=vias_out,
        secciones=sec_out,
        cdvs=cdv_out,
        juntas=juntas_out,
        senales=signals,
        agujas=switches,
        andenes=platforms,
        balizas=balises,
        psp=psp,
        marcadores_al=al,
        puntos_libramiento=fp,
        avc=avc,
        topes=topes,
        limites=limits,
        eje_pk=pk_axis,
        observaciones=observ,
    )


def sha256(path: str) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def interlocking_areas(events_path: str):
    """Estación → enclavamiento / ATP según quién ejecuta o rechaza los comandos del regulador."""
    from validar_log import iter_rows
    rx = re.compile(r'^Comando \S+ ([A-Z]{3}) .*?(?:ejecutado|rechazado) por ((?:PAN|OBS)(?:IXL|ATP))')
    cnt = defaultdict(lambda: defaultdict(int))
    for row in iter_rows(events_path):
        if str(row[0]) not in ('COMMAND_ACK', 'COMMAND_NACK'):
            continue
        m = rx.match(str(row[2] or ''))
        if m:
            cnt[m.group(1)][m.group(2)] += 1
    out = {}
    for st, c in cnt.items():
        if st not in ST_CODES:
            continue
        ixl = max((k for k in c if k.endswith('IXL')), key=lambda k: c[k], default=None)
        atp = max((k for k in c if k.endswith('ATP')), key=lambda k: c[k], default=None)
        out[st] = dict(ixl=ixl, atp=atp, comandos={k: v for k, v in sorted(c.items())})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--senal', required=True)
    ap.add_argument('--cdv', required=True)
    ap.add_argument('--fuentes', required=True, help='JSON con metadatos de las fuentes (código, revisión, fecha)')
    ap.add_argument('--eventos', help='log de eventos del ATS (opcional): deriva estación → enclavamiento/ATP')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    data = build(args.senal, args.cdv)
    import extras
    ext = extras.construir(args.senal, args.cdv, data)
    ext.pop('_juntas_con_equipos', None)
    data['observaciones'] += ext.pop('observaciones_extra', [])
    data.update(ext)
    fuentes = json.load(open(args.fuentes, encoding='utf-8'))
    files = {'SEN': args.senal, 'CDV': args.cdv, 'LOG': args.eventos}
    for f in fuentes:
        p = files.get(f['id'])
        if p:
            f['sha256'] = sha256(p)
    if args.eventos:
        areas = interlocking_areas(args.eventos)
        for e in data['estaciones']:
            a = areas.get(e['codigo'])
            if a:
                e['enclavamiento'] = a['ixl']
                e['atp'] = a['atp']
                e['enclavamiento_fuente'] = 'LOG'
        # identificadores del log sin elemento en el esquemático
        from validar_log import validar
        import fitz
        cdv_txt = fitz.open(args.cdv)[0].get_text()
        _, _, unresolved, ejemplo = validar(data, args.eventos)
        for cat, cnt in unresolved.items():
            for ident, k in cnt.items():
                t, d = ejemplo[(cat, ident)]
                en_cdv = isinstance(ident, str) and ident in cdv_txt
                data['observaciones'].append(dict(
                    tipo='id_log_sin_elemento',
                    detalle=(f'{ident} aparece {k} vez/veces en el log ({t[:19]}: «{d}») y no figura en la hoja 1/25 '
                             f'del plano de señalización' + ('; sí figura en el plano de circuitos de vía' if en_cdv else ''))))
    else:
        fuentes = [f for f in fuentes if f['id'] != 'LOG']
    data['capas'] = {
        'vias': ['SEN'], 'secciones': ['SEN'], 'cdvs': ['SEN', 'CDV'], 'juntas': ['SEN', 'CDV'],
        'senales': ['SEN'], 'agujas': ['SEN'], 'andenes': ['SEN'], 'balizas': ['SEN'], 'psp': ['SEN'],
        'marcadores_al': ['SEN'], 'puntos_libramiento': ['SEN'], 'avc': ['SEN'], 'topes': ['SEN'],
        'limites': ['SEN'], 'estaciones': ['SEN', 'LOG'] if args.eventos else ['SEN'],
        'regla_sen': ['SEN'], 'perfil': ['SEN'], 'equipos': ['SEN', 'CDV'], 'rotulos': ['SEN'],
        'zonas': ['SEN'], 'encabezado': ['SEN', 'CDV'], 'regla_cdv': ['CDV'], 'armarios': ['CDV'],
        'subestaciones': ['CDV'], 'carteles': ['CDV'], 'tramos': ['CDV'], 'notas': ['CDV'],
    }
    out = dict(
        esquema='stc-operacion/esquematico-l1',
        version=1,
        generado=dt.datetime.now().strftime('%Y-%m-%d %H:%M'),
        fuentes=fuentes,
        **data,
    )
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    n = {k: len(v) for k, v in data.items() if isinstance(v, list)}
    print(json.dumps(n, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
