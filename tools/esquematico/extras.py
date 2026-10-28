"""Capas adicionales del esquemático: todo lo que traen los planos además de la topología de vías.

Plano de señalización (hoja 1/25, mismas coordenadas del lienzo):
  - regla de PK del plano, perfil de velocidades (zonas de estación, curvas con radio, velocidad en agujas),
    pendientes, salas MX / OC / ZC / WCU, rótulos, cabecera completa (PK de cada elemento).
Plano de señalización (hojas 24/25, misma geometría desplazada en y): zonas RAUZ_BFU_* y ASR_*.
Plano de circuitos de vía (otra geometría; se lleva al lienzo por PK con las dos reglas):
  - subestaciones (S/E), cartelones de aviso / ejecución, tramos subterráneo / techado,
  - ubicaciones de equipos de CDV (cajas XXX-nn.n con 50T/100T y su extensión),
  - por junta: tipo de lazo, unidades D10-Bn, R1/R2, lazo de compensación (*) de 300 mm²,
  - RESET, RST-PML, sala técnica, OC/ZC/WCU (incl. provisionales *), notas.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict

from header import read_header
from pdfgeom import Page, Text, load_page, parse_pk

PK_RE = re.compile(r'^-?\d+\+\d{3}(?:\.\d+)?$')
RULER_RE = re.compile(r'^\d{1,2},\d{3}$')
NUM_RE = re.compile(r'^\d{1,3}$')
PERMIL_RE = re.compile(r'^(-?\d+(?:\.\d+)?)‰$')
ARM_RE = re.compile(r'^([A-Z]{3}-\d{2}\.\d)\s*(?:1?\((\d)\))?$')


def r2(v):
    return None if v is None else round(float(v), 2)


def r3(v):
    return None if v is None else round(float(v), 3)


def uniq_texts(texts: list[Text]) -> list[Text]:
    seen = set()
    out = []
    for t in texts:
        k = (t.t, round(t.x0, 1), round(t.y0, 1), t.color)
        if k in seen:
            continue
        seen.add(k)
        out.append(t)
    return out


# ───────────────────────────── reglas de PK ─────────────────────────────

class Eje:
    """x ↔ PK lineal a tramos (PK decreciente con x). Extrapola con la pendiente de los extremos."""

    def __init__(self, pts: list[tuple[float, float]]):
        self.pts = pts
        self.xs = [p[0] for p in pts]
        self.pks = [p[1] for p in pts]

    @staticmethod
    def _interp(xs, ys, v):
        n = len(xs)
        if n < 2:
            return None
        if v <= xs[0]:
            i = 1
        elif v >= xs[-1]:
            i = n - 1
        else:
            lo, hi = 0, n - 1
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if xs[mid] <= v:
                    lo = mid
                else:
                    hi = mid
            i = hi
        x0, x1, y0, y1 = xs[i - 1], xs[i], ys[i - 1], ys[i]
        if x1 == x0:
            return y0
        return y0 + (v - x0) * (y1 - y0) / (x1 - x0)

    def pk(self, x):
        return self._interp(self.xs, self.pks, x)

    def x(self, pk):
        return self._interp(self.pks[::-1], self.xs[::-1], pk)


def read_ruler(texts: list[Text], y_max: float = 25.0) -> list[tuple[float, float]]:
    pts = sorted((t.cx, float(t.t.replace(',', ''))) for t in texts
                 if t.horizontal and t.y1 < y_max and RULER_RE.match(t.t))
    dedup = []
    for x, pk in pts:
        if dedup and abs(dedup[-1][0] - x) < 0.5:
            continue
        dedup.append((x, pk))
    # subsecuencia estrictamente decreciente más larga (descarta rótulos fuera de secuencia)
    n = len(dedup)
    best = [1] * n
    prev = [-1] * n
    for i in range(n):
        for j in range(i):
            if dedup[j][1] > dedup[i][1] and best[j] + 1 > best[i]:
                best[i], prev[i] = best[j] + 1, j
    i = max(range(n), key=lambda k: best[k]) if n else -1
    out = []
    while i >= 0:
        out.append(dedup[i])
        i = prev[i]
    return out[::-1]


def num_radio(s: str) -> float | None:
    """'582.2' → 582.2; '1.198.550' (punto de miles) → 1198.55."""
    s = s.strip()
    if not re.match(r'^[\d.]+$', s):
        return None
    if s.count('.') > 1:
        a, b = s.rsplit('.', 1)
        s = a.replace('.', '') + '.' + b
    try:
        return float(s)
    except ValueError:
        return None


def via_de_codigo(code: str) -> str | None:
    """'01' → V1, '02' → V2, '42' → V42, 'A' → VA."""
    if not code:
        return None
    if code.isdigit():
        return 'V' + str(int(code))
    return 'V' + code


# ───────────────────────────── perfil (plano de señalización) ─────────────────────────────

def perfil(sen: Page):
    small = uniq_texts([t for t in sen.texts if t.horizontal and abs(t.size - 1.49) < 0.06])
    tiny = uniq_texts([t for t in sen.texts if t.horizontal and abs(t.size - 0.99) < 0.06])
    colored_pk = {(round(t.x0, 1), round(t.y0, 1)) for t in small if t.color != '000000' and PK_RE.match(t.t)}

    def near(pred, cx, y0a, y0b, dx):
        return [t for t in small if pred(t) and y0a < t.y0 < y0b and abs(t.cx - cx) < dx]

    puntos = []
    for color, tipo, name_re in (('0080ff', 'estacion', re.compile(r'^[A-Z]{3}_\d{2}$')),
                                 ('00b300', 'curva', re.compile(r'^CMXV[0-9A-Z]+_\d+$'))):
        for a in [t for t in small if t.color == color and PK_RE.match(t.t)]:
            cx = a.cx
            row = near(lambda t: NUM_RE.match(t.t), cx, a.y0 - 3.4, a.y0 - 1.0, 4.6)
            left = sorted([t for t in row if t.cx < cx], key=lambda t: cx - t.cx)
            right = sorted([t for t in row if t.cx > cx], key=lambda t: t.cx - cx)
            names = sorted(near(lambda t: t.color == color and name_re.match(t.t), cx, a.y0 - 6.4, a.y0 - 3.0, 12),
                           key=lambda t: abs(t.cx - cx))
            if not names:
                continue
            nm = names[0].t
            m = re.match(r'^(?:CMXV)?([0-9A-Z]+?)_\d+$', nm) if tipo == 'curva' else re.match(r'^[A-Z]{3}_(\d{2})$', nm)
            via = via_de_codigo(m.group(1)) if m else None
            vi = int(left[0].t) if left else None
            vd = int(right[0].t) if right else None
            lado = 'der' if right and right[0].color == color else ('izq' if left and left[0].color == color else None)
            puntos.append(dict(tipo=tipo, nombre=nm, via=via, pk=r3(parse_pk(a.t)), pk_texto=a.t, x=r2(cx), y=r2(a.cy),
                               v_izq=vi, v_der=vd, lado_zona=lado))

    # radios de curva (grupo superior, color 52a452)
    radios = []
    for t in tiny:
        m = re.match(r'^R=\s*([\d.]+)$', t.t)
        if m and num_radio(m.group(1)) is not None:
            radios.append((t.cx, t.cy, num_radio(m.group(1))))
        elif t.t == 'R=':
            nxt = [u for u in tiny if abs(u.y0 - t.y0) < 0.2 and 0 <= u.x0 - t.x1 < 0.6 and num_radio(u.t) is not None]
            if nxt:
                radios.append((t.cx, t.cy, num_radio(nxt[0].t)))
    curva_pk = [t for t in small if t.color == '52a452' and PK_RE.match(t.t)]

    zonas = []
    by = defaultdict(list)
    for p in puntos:
        by[(p['tipo'], p['nombre'])].append(p)
    for (tipo, nombre), ps in by.items():
        ps.sort(key=lambda p: p['x'])
        i = 0
        while i < len(ps):
            a = ps[i]
            b = ps[i + 1] if i + 1 < len(ps) else None
            if b is not None and a['lado_zona'] != 'izq' and b['lado_zona'] != 'der':
                v = a['v_der'] if a['lado_zona'] == 'der' else b['v_izq']
                fuera = a['v_izq']
                z = dict(tipo=tipo, nombre=nombre, via=a['via'], x0=a['x'], x1=b['x'], pk_ini=a['pk'], pk_fin=b['pk'],
                         v=v, v_fuera=fuera, y=a['y'])
                if tipo == 'curva':
                    rs = []
                    for c in curva_pk:
                        if a['x'] - 8 < c.cx < b['x'] + 8 and abs(c.cy - a['y']) < 20:
                            rr = [r for r in radios if abs(r[1] - c.cy) < 3 and abs(r[0] - c.cx) < 9]
                            rs += [r[2] for r in rr]
                    z['radio_m'] = min(rs) if rs else None
                zonas.append(z)
                i += 2
            else:
                zonas.append(dict(tipo=tipo, nombre=nombre, via=a['via'], x0=a['x'], x1=a['x'], pk_ini=a['pk'],
                                  pk_fin=a['pk'], v=a['v_der'] if a['lado_zona'] == 'der' else a['v_izq'],
                                  v_fuera=None, y=a['y'], incompleta=True))
                i += 1

    # velocidad en agujas (naranja)
    agujas = []
    orange = [t for t in small if t.color == 'ff8000']
    for n in [t for t in orange if re.match(r'^A[0-9A-Z]+$', t.t)]:
        v = sorted([t for t in orange if NUM_RE.match(t.t) and abs(t.cx - n.cx) < 7 and abs(t.cy - n.cy) < 4.5],
                   key=lambda t: abs(t.cy - n.cy) + abs(t.cx - n.cx))
        pkl = [t for t in orange if PK_RE.match(t.t) and abs(t.cx - n.cx) < 10 and abs(t.cy - n.cy) < 6]
        agujas.append(dict(aguja=n.t, v=int(v[0].t) if v else None, pk_local=[t.t for t in pkl],
                           x=r2(n.cx), y=r2(n.cy)))

    # pendientes (negro): puntos de cambio y tramos
    pend_pts = []
    for a in [t for t in small if t.color == '000000' and PK_RE.match(t.t)]:
        if (round(a.x0, 1), round(a.y0, 1)) in colored_pk:
            continue
        cx = a.cx
        vals = near(lambda t: PERMIL_RE.match(t.t), cx, a.y0 - 5.6, a.y0 - 3.4, 9.5)
        nms = near(lambda t: re.match(r'^GMX[0-9A-Z_]+$', t.t), cx, a.y0 + 0.4, a.y0 + 2.2, 12.5)
        if not vals and not nms:
            continue
        vl = sorted([t for t in vals if t.cx < cx], key=lambda t: cx - t.cx)
        vr = sorted([t for t in vals if t.cx > cx], key=lambda t: t.cx - cx)
        nl = sorted([t for t in nms if t.cx < cx], key=lambda t: cx - t.cx)
        nr = sorted([t for t in nms if t.cx > cx], key=lambda t: t.cx - cx)
        pend_pts.append(dict(pk=r3(parse_pk(a.t)), pk_texto=a.t, x=r2(cx), y=r2(a.cy),
                             p_izq=float(PERMIL_RE.match(vl[0].t).group(1)) if vl else None,
                             p_der=float(PERMIL_RE.match(vr[0].t).group(1)) if vr else None,
                             n_izq=nl[0].t if nl else None, n_der=nr[0].t if nr else None))
    pend = []
    seg = defaultdict(dict)
    for p in pend_pts:
        if p['n_der']:
            seg[p['n_der']].setdefault('ini', []).append(p)
        if p['n_izq']:
            seg[p['n_izq']].setdefault('fin', []).append(p)
    for nm, d in seg.items():
        m = re.match(r'^GMX(?:V([0-9A-Z]+?)_\d+|A(\w+))$', nm)
        via = via_de_codigo(m.group(1)) if m and m.group(1) else None
        aguja = ('A' + m.group(2)) if m and m.group(2) else None
        ini = min(d.get('ini', []), key=lambda p: p['x'], default=None)
        fin = max(d.get('fin', []), key=lambda p: p['x'], default=None)
        val = (ini or {}).get('p_der')
        if val is None and fin:
            val = fin.get('p_izq')
        pend.append(dict(nombre=nm, via=via, aguja=aguja, x0=ini['x'] if ini else None, x1=fin['x'] if fin else None,
                         pk_ini=ini['pk'] if ini else None, pk_fin=fin['pk'] if fin else None, permil=val,
                         y=(ini or fin)['y']))
    pend.sort(key=lambda s: (s['via'] or '', s['x0'] if s['x0'] is not None else s['x1'] or 0))
    return dict(zonas_velocidad=zonas, puntos_velocidad=puntos, velocidad_agujas=agujas,
                pendientes=pend, puntos_pendiente=pend_pts)


# ───────────────────────────── equipos y rótulos (plano de señalización) ─────────────────────────────

def nearest_station(estaciones, x):
    best = None
    for e in estaciones:
        if e.get('x') is None:
            continue
        d = abs(e['x'] - x)
        if best is None or d < best[0]:
            best = (d, e['codigo'])
    return best[1] if best else None


def equipos_sen(sen: Page, estaciones):
    out = []
    for t in sen.texts:
        s = t.t.strip()
        m = re.match(r'^(OC|ZC|WCU)(\*?)$', s)
        if m and t.horizontal:
            out.append(dict(tipo=m.group(1), id=s, provisional=bool(m.group(2)), x=r2(t.cx), y=r2(t.cy),
                            estacion=nearest_station(estaciones, t.cx), fuente='SEN'))
        m = re.match(r'^MX(\d{3})$', s)
        if m and t.horizontal:
            out.append(dict(tipo='MX', id=s, provisional=False, x=r2(t.cx), y=r2(t.cy),
                            estacion=nearest_station(estaciones, t.cx), fuente='SEN'))
    return out


ROTULO_RE = re.compile(r'ANDÉN|FOSO|TALLER|LÍNEA \d|SALA|^VÍA [A-Z]$|^VÍA \d+$')


def rotulos_sen(sen: Page):
    out = []
    for t in sen.texts:
        if t.y0 < 96 or t.size < 2.4 or t.x0 > 9380 or t.t in ('VÍA 1', 'VÍA 2'):
            continue
        if ROTULO_RE.search(t.t):
            ang = math.degrees(math.atan2(t.dir[1], t.dir[0]))
            out.append(dict(texto=t.t, x=r2(t.cx), y=r2(t.cy), size=t.size, ang=round(ang, 1), fuente='SEN'))
    return out


def encabezado(texts: list[Text], fuente: str, x_map=None):
    out = []
    for h in read_header(texts):
        if h.name in ('S/E',) and h.pk is None:
            continue
        x = x_map(h.x) if x_map else h.x
        out.append(dict(texto=h.name, pk=r3(h.pk_best), pk_texto=h.pk_text, pk_aux=h.pk_aux_text,
                        color=h.color, x=r2(x), fuente=fuente))
    return out


# ───────────────────────────── zonas RAUZ / ASR (hojas 24 y 25) ─────────────────────────────

def zonas_hoja(senal_pdf: str, pno: int, prefijo: str, sen1: Page, vias, eje: Eje):
    """Zonas dibujadas como imágenes semitransparentes con su rótulo (hojas 24 y 25)."""
    import pymupdf
    pg = load_page(senal_pdf, pno)
    raw = pymupdf.open(senal_pdf)[pno]
    imgs = [i for i in raw.get_image_info(xrefs=True)]
    # desplazamiento vertical respecto de la hoja 1: mediana sobre rótulos idénticos
    idx1 = defaultdict(list)
    for t in sen1.texts:
        if t.horizontal and len(t.t) > 4:
            idx1[t.t].append(t)
    dys = []
    for t in pg.texts:
        for u in idx1.get(t.t, []):
            if abs(u.x0 - t.x0) < 0.05:
                dys.append(round(u.y0 - t.y0, 2))
    dy = sorted(dys)[len(dys) // 2] if dys else 0.0
    out = []
    for t in pg.texts:
        if not t.t.startswith(prefijo):
            continue
        cands = [i['bbox'] for i in imgs if i['bbox'][0] - 0.5 <= t.cx <= i['bbox'][2] + 0.5
                 and i['bbox'][1] - 0.5 <= t.cy <= i['bbox'][3] + 0.5
                 and (i['bbox'][2] - i['bbox'][0]) > 20 and (i['bbox'][3] - i['bbox'][1]) > 8]
        if not cands:
            continue
        b = min(cands, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        x0, x1, y0, y1 = b[0], b[2], b[1] + dy, b[3] + dy
        vs = set()
        for v in vias:
            ax, ay, bx, by_ = v['pts']
            if max(ax, bx) < x0 or min(ax, bx) > x1:
                continue
            xm = (max(min(ax, bx), x0) + min(max(ax, bx), x1)) / 2
            ym = ay + (xm - ax) * (by_ - ay) / (bx - ax) if bx != ax else (ay + by_) / 2
            if y0 - 0.3 <= ym <= y1 + 0.3 and v['via'] and v['via'] != '?':
                vs.add(v['via'])
        out.append(dict(id=t.t.strip(), tipo=prefijo.rstrip('_'), x0=r2(x0), x1=r2(x1), y0=r2(y0), y1=r2(y1),
                        vias=sorted(vs), pk_ini=r3(eje.pk(x0)), pk_fin=r3(eje.pk(x1)), hoja=pno + 1))
    return out, dy


# ───────────────────────────── plano de CDV ─────────────────────────────

def dashed_columns(page: Page):
    """Columnas de trazos verticales cortos (cajas a trazos de las ubicaciones de equipos)."""
    cols = defaultdict(list)
    for s in page.segs:
        if abs(s.x0 - s.x1) < 0.05 and 0.3 < abs(s.y1 - s.y0) < 7 and s.width < 0.5:
            cols[round(s.x0, 1)].append((min(s.y0, s.y1), max(s.y0, s.y1)))
    out = []
    for x, iv in cols.items():
        if len(iv) < 4:
            continue
        iv.sort()
        runs = [[iv[0][0], iv[0][1], 1]]
        for a, b in iv[1:]:
            if a - runs[-1][1] <= 4.5:
                runs[-1][1] = max(runs[-1][1], b)
                runs[-1][2] += 1
            else:
                runs.append([a, b, 1])
        for a, b, n in runs:
            if n >= 4 and b - a > 15:
                out.append((x, a, b))
    return out


def plano_cdv(cdv_pdf: str, data: dict, eje_sen: Eje):
    pg = load_page(cdv_pdf, 0)
    eje_cdv = Eje(read_ruler(pg.texts))

    def xs(xc):
        pk = eje_cdv.pk(xc)
        return eje_sen.x(pk) if pk is not None else None

    cdv_alias = {}
    for c in data['cdvs']:
        cdv_alias[c['id']] = c
        for a in c.get('alias', []):
            cdv_alias[a] = c
    labels = [t for t in pg.texts if t.color == '00cc00' and re.match(r'^C[0-9Z][0-9A-Z]*$', t.t)]

    def via_at(x, y):
        cands = [t for t in labels if abs(t.cx - x) < 160]
        if not cands:
            return None, None
        t = min(cands, key=lambda t: abs(t.cy - y) * 3 + abs(t.cx - x) * 0.05)
        c = cdv_alias.get(t.t)
        vias = c['vias'] if c else []
        via = next((v for v in vias if '/' not in v), vias[0] if vias else None)
        return via, t.t

    head = read_header(pg.texts)
    head_j = []
    for h in head:
        m = re.match(r'^\((V[0-9A-Z]+|L\d)\)(LS|LC|LT|AC|JAR|J)$', h.name)
        if m and h.pk is not None:
            head_j.append(dict(via=m.group(1), tipo=m.group(2), pk=h.pk, x=h.x))

    def joint_for(x, via, maxdx=14.0):
        c = [j for j in head_j if j['via'] == via and abs(j['x'] - x) < maxdx]
        if not c:
            near = [j for j in head_j if abs(j['x'] - x) < maxdx]
            if near and len({j['via'] for j in near}) == 1:
                c = near
        return min(c, key=lambda j: abs(j['x'] - x)) if c else None

    # equipos asociados a juntas
    por_junta = defaultdict(lambda: dict(sintonia=[], r=[], compensacion=False))
    d10 = sorted([t for t in pg.texts if re.match(r'^D10-B\d+$', t.t)], key=lambda t: (t.cx, t.cy))
    used = set()
    cajas = []
    for i, t in enumerate(d10):
        if i in used:
            continue
        grp = [t]
        used.add(i)
        for j, u in enumerate(d10):
            if j not in used and abs(u.x0 - t.x0) < 1.5 and 0 < abs(u.cy - t.cy) < 3.5:
                grp.append(u)
                used.add(j)
        grp.sort(key=lambda u: u.cy)
        cx = sum(u.cx for u in grp) / len(grp)
        cy = sum(u.cy for u in grp) / len(grp)
        cajas.append((cx, cy, [u.t for u in grp]))
    for cx, cy, cods in cajas:
        via, lab = via_at(cx, cy)
        j = joint_for(cx - 6, via, 16) if via else None
        key = (via, j['pk']) if j else None
        if key:
            por_junta[key]['sintonia'].append(cods)
    for t in pg.texts:
        if t.color == '00cc00' and t.t in ('R', 'R1', 'R2'):
            via, _ = via_at(t.cx, t.cy)
            j = joint_for(t.cx, via, 10) if via else None
            if j:
                por_junta[(via, j['pk'])]['r'].append(t.t)
        if t.t == '(*)':
            via, _ = via_at(t.cx, t.cy)
            j = joint_for(t.cx, via, 10) if via else None
            if j:
                por_junta[(via, j['pk'])]['compensacion'] = True

    # ubicaciones de equipos de CDV (cajas a trazos)
    cols = dashed_columns(pg)
    armarios = []
    for t in pg.texts:
        m = ARM_RE.match(t.t.strip())
        if not m or not t.horizontal:
            continue
        cap = [u for u in pg.texts if u.t in ('50T', '100T') and abs(u.cx - t.cx) < 9 and 0 < u.cy - t.cy < 7]
        cover = [c for c in cols if c[1] - 3 <= t.cy <= c[2] + 3]
        left = [c[0] for c in cover if c[0] < t.x0 - 0.5 and t.x0 - c[0] < 260]
        right = [c[0] for c in cover if c[0] > t.x1 + 0.5 and c[0] - t.x1 < 260]
        xl = max(left) if left else None
        xr = min(right) if right else None
        armarios.append(dict(id=m.group(1), nota=m.group(2), capacidad=cap[0].t if cap else None,
                             x=r2(xs(t.cx)), x0=r2(xs(xl)) if xl is not None else None,
                             x1=r2(xs(xr)) if xr is not None else None,
                             pk=r3(eje_cdv.pk(t.cx)), pk_ini=r3(eje_cdv.pk(xl)) if xl is not None else None,
                             pk_fin=r3(eje_cdv.pk(xr)) if xr is not None else None,
                             lado='arriba' if t.cy < 228 else 'abajo', estacion=t.t[:3]))

    # clave única por ubicación (el plano repite algún rótulo)
    cnt = defaultdict(int)
    for a in armarios:
        cnt[a['id']] += 1
    obs = []
    for a in armarios:
        if cnt[a['id']] > 1:
            k = int(a['pk']) if a['pk'] is not None else 0
            a['clave'] = f"{a['id']}@{k // 1000}+{k % 1000:03d}"
        else:
            a['clave'] = a['id']
    for nm, n in cnt.items():
        if n > 1:
            pks = ', '.join(c['clave'].split('@')[1] for c in armarios if c['id'] == nm)
            obs.append(dict(tipo='armario_repetido',
                            detalle=f'La ubicación {nm} aparece {n} veces en el plano de CDV (PK {pks})'))

    # subestaciones
    subs = []
    names = [t for t in pg.texts if t.horizontal and re.match(r'^S/E\s+\S', t.t) and t.color == 'ff0000']
    for h in head:
        if not h.name.startswith('S/E') or h.pk is None:
            continue
        nm = h.name[3:].strip()
        if not nm:
            c = sorted(names, key=lambda t: abs(t.cx - h.x))
            nm = c[0].t[3:].strip() if c and abs(c[0].cx - h.x) < 70 else None
        subs.append(dict(nombre=nm, pk=r3(h.pk), pk_texto=h.pk_text, x=r2(xs(h.x)), fuente='CDV'))
    # S/E sin entrada en la cabecera (sólo rótulo)
    for t in names:
        nm = t.t[3:].strip()
        if not any(s['nombre'] == nm for s in subs):
            subs.append(dict(nombre=nm, pk=r3(eje_cdv.pk(t.cx)), pk_texto=None, x=r2(xs(t.cx)), fuente='CDV',
                             obs='sin PK en la cabecera; posición del rótulo'))

    carteles = []
    tramos = []
    for h in head:
        if h.name.startswith('CARTELÓN') and h.pk is not None:
            carteles.append(dict(tipo='aviso' if 'AVISO' in h.name else 'ejecucion', texto=h.name, pk=r3(h.pk),
                                 pk_texto=h.pk_text, x=r2(xs(h.x))))
    for t in pg.texts:
        if 'TRAMO' in t.t and ':' not in t.t and t.x0 < 7555:
            tramos.append(dict(texto=t.t, tipo='inicio' if t.t.startswith('INICIO') else 'fin',
                               pk=r3(eje_cdv.pk(t.cx)), x=r2(xs(t.cx))))

    otros = []
    for t in pg.texts:
        s = t.t.strip()
        m = re.match(r'^(OC|ZC|WCU)(\*?)$', s)
        tipo = None
        if m:
            tipo = m.group(1)
        elif s == 'RESET':
            tipo = 'RESET'
        elif s == 'RST-PML':
            tipo = 'PML'
        elif s.startswith('SALA TÉCNICA'):
            tipo = 'SALA'
        if tipo:
            via, _ = via_at(t.cx, t.cy)
            otros.append(dict(tipo=tipo, id=s, provisional=s.endswith('*'), x=r2(xs(t.cx)), pk=r3(eje_cdv.pk(t.cx)),
                              lado='arriba' if t.cy < 228 else 'abajo', via=via, fuente='CDV'))

    notas = []
    seen = set()
    for t in pg.texts:
        if t.t.startswith('(*) Lazo') or t.t.startswith('* LOS PUNTOS') or t.t.startswith('(1)LOCALIZACIÓN'):
            if t.t in seen:
                continue
            seen.add(t.t)
            cont = [u.t for u in pg.texts if abs(u.x0 - t.x0) < 0.6 and 0 < u.y0 - t.y0 < 9]
            notas.append(dict(texto=' '.join([t.t] + cont), fuente='CDV'))

    enc = encabezado(pg.texts, 'CDV', xs)
    return dict(regla_cdv=[[r2(x), pk] for x, pk in eje_cdv.pts], por_junta=por_junta, armarios=armarios, obs=obs,
                subestaciones=subs, carteles=carteles, tramos=tramos, equipos_cdv=otros, notas=notas,
                encabezado=enc, eje_cdv=eje_cdv)


# ───────────────────────────── principal ─────────────────────────────

def seccion_en(data, x, y):
    for s in data['secciones']:
        for t in s['tramos']:
            x0, y0, x1, y1 = t
            if min(x0, x1) - 0.3 <= x <= max(x0, x1) + 0.3:
                yy = y0 if x1 == x0 else y0 + (x - x0) * (y1 - y0) / (x1 - x0)
                if abs(yy - y) < 0.8:
                    return s
    return None


def construir(senal_pdf: str, cdv_pdf: str, data: dict) -> dict:
    sen = load_page(senal_pdf, 0)
    regla = read_ruler(sen.texts)
    eje = Eje(regla)
    out = dict(regla_sen=[[r2(x), pk] for x, pk in regla])
    out['perfil'] = perfil(sen)
    eq = equipos_sen(sen, data['estaciones'])
    out['rotulos'] = rotulos_sen(sen)
    out['encabezado'] = encabezado(sen.texts, 'SEN')
    rauz, dy24 = zonas_hoja(senal_pdf, 23, 'RAUZ_', sen, data['vias'], eje)
    asr, dy25 = zonas_hoja(senal_pdf, 24, 'ASR_', sen, data['vias'], eje)
    out['zonas'] = rauz + asr

    c = plano_cdv(cdv_pdf, data, eje)
    out['regla_cdv'] = c['regla_cdv']
    out['armarios'] = c['armarios']
    out['subestaciones'] = c['subestaciones']
    out['carteles'] = c['carteles']
    out['tramos'] = c['tramos']
    out['notas'] = c['notas']
    out['observaciones_extra'] = c['obs']
    out['encabezado'] += c['encabezado']
    # equipos del plano de CDV que no tienen par en el de señalización
    for o in c['equipos_cdv']:
        if o['tipo'] in ('OC', 'ZC', 'WCU') and not o['provisional']:
            if any(e['tipo'] == o['tipo'] and o['x'] is not None and abs(e['x'] - o['x']) < 40 for e in eq):
                continue
        o['estacion'] = nearest_station(data['estaciones'], o['x']) if o['x'] is not None else None
        eq.append(o)
    out['equipos'] = eq

    # juntas: datos del plano de CDV (lazo, unidades D10, R1/R2, compensación)
    n_eq = 0
    for j in data['juntas']:
        if j['tipo'] != 'fisica' or j.get('pk') is None or not j.get('via'):
            continue
        best = None
        for (via, pk), info in c['por_junta'].items():
            if via == j['via'] and abs(pk - j['pk']) < 1.6:
                if best is None or abs(pk - j['pk']) < best[0]:
                    best = (abs(pk - j['pk']), info)
        if best:
            info = best[1]
            j['sintonia'] = info['sintonia']
            j['r'] = sorted(set(info['r']))
            j['compensacion'] = info['compensacion']
            n_eq += 1
        arm = [a for a in c['armarios'] if a['x0'] is not None and a['x1'] is not None and a['x0'] - 0.3 <= j['x'] <= a['x1'] + 0.3
               and ((a['lado'] == 'arriba') == (j['y'] < 228) or True)]
        if arm:
            j['armarios'] = sorted({a['clave'] for a in arm})
    out['_juntas_con_equipos'] = n_eq

    # balizas: vía, sección, CDV y estación
    for b in data['balizas']:
        s = seccion_en(data, b['x'], b['y'])
        if s:
            b['seccion'] = s['id']
            b['cdv'] = s['cdv']
            b['estacion'] = s['estacion']
            b['via'] = s['vias'][0] if s['vias'] else None
    # CDV: ubicaciones de equipos de sus juntas extremas (o, si no hay, las que cubren su extensión)
    for cd in data['cdvs']:
        ends = [j for j in data['juntas'] if j['tipo'] == 'fisica' and j.get('pk') is not None
                and any(abs(j['pk'] - p) < 0.05 for p in cd.get('pk_juntas', []))
                and (j.get('via') in cd['vias'] or any(j.get('via') in v.split('/') for v in cd['vias']))]
        arms = sorted({a for j in ends for a in j.get('armarios', [])})
        if not arms:
            xs_ = [v for t in cd['tramos'] for v in (t[0], t[2])]
            if xs_:
                a0, a1 = min(xs_), max(xs_)
                arms = sorted({a['clave'] for a in c['armarios'] if a['x0'] is not None and a['x1'] is not None
                               and a['x0'] < a1 and a['x1'] > a0})
        cd['armarios'] = arms
    return out
