"""Construcción del grafo de vías (tira unifilar) a partir de las líneas negras del plano de señalización."""
from __future__ import annotations

import math
from collections import defaultdict

from pdfgeom import Seg, point_seg_dist, seg_intersection

BLACK = (0.0, 0.0, 0.0)


def is_track_candidate(s: Seg, area) -> bool:
    if s.color != BLACK or abs(s.width - 0.24) > 0.01:
        return False
    if s.length < 0.5:
        return False
    if s.is_vertical(0.08):
        return False
    x0, y0, x1, y1 = area
    return x0 <= min(s.x0, s.x1) and max(s.x0, s.x1) <= x1 and y0 <= min(s.y0, s.y1) and max(s.y0, s.y1) <= y1


def _norm(s: Seg):
    if (s.x1, s.y1) < (s.x0, s.y0):
        return (s.x1, s.y1, s.x0, s.y0)
    return (s.x0, s.y0, s.x1, s.y1)


def merge_collinear(lines, ytol=0.15, gap=3.4, angtol=0.01):
    """Une segmentos colineales que se tocan o solapan."""
    groups = defaultdict(list)
    for l in lines:
        x0, y0, x1, y1 = l
        ang = math.atan2(y1 - y0, x1 - x0)
        # intercepto perpendicular
        nx, ny = -math.sin(ang), math.cos(ang)
        c = x0 * nx + y0 * ny
        groups[(round(ang / angtol), round(c / ytol))].append(l)
    out = []
    for key, ls in groups.items():
        ls.sort()
        cur = list(ls[0])
        for l in ls[1:]:
            # proyección sobre la dirección del grupo
            ang = math.atan2(cur[3] - cur[1], cur[2] - cur[0]) if (cur[2], cur[3]) != (cur[0], cur[1]) else 0
            ux, uy = math.cos(ang), math.sin(ang)
            cur_end = cur[2] * ux + cur[3] * uy
            l_start = l[0] * ux + l[1] * uy
            l_end = l[2] * ux + l[3] * uy
            if l_start <= cur_end + gap:
                if l_end > cur_end:
                    cur[2], cur[3] = l[2], l[3]
            else:
                out.append(tuple(cur))
                cur = list(l)
        out.append(tuple(cur))
    return out


class TrackGraph:
    def __init__(self):
        self.nodes: list[tuple[float, float]] = []
        self.edges: list[dict] = []  # {a, b, pts:[(x,y),(x,y)]}
        self.crossings: list[tuple[float, float]] = []

    def node_id(self, x, y, tol=0.7):
        for i, (nx, ny) in enumerate(self.nodes):
            if abs(nx - x) <= tol and abs(ny - y) <= tol:
                return i
        self.nodes.append((x, y))
        return len(self.nodes) - 1

    def degree(self):
        d = defaultdict(int)
        for e in self.edges:
            d[e['a']] += 1
            d[e['b']] += 1
        return d


def chain_dashes(lines, max_len=4.0, gap=3.8, angtol=0.3, min_count=4):
    """Une trazos cortos de una línea discontinua (p. ej. enlace con Línea 2) en un único segmento."""
    short = [l for l in lines if math.hypot(l[2] - l[0], l[3] - l[1]) < max_len]
    rest = [l for l in lines if math.hypot(l[2] - l[0], l[3] - l[1]) >= max_len]

    def ang(l):
        return math.atan2(l[3] - l[1], l[2] - l[0])

    n = len(short)
    nxt = {}
    for i, a in enumerate(short):
        best = None
        for j, b in enumerate(short):
            if i == j:
                continue
            d = math.hypot(b[0] - a[2], b[1] - a[3])
            if d > gap or d < 0.3:
                continue
            da = abs((ang(a) - ang(b) + math.pi / 2) % math.pi - math.pi / 2)
            if da > angtol:
                continue
            gv = math.atan2(b[1] - a[3], b[0] - a[2])
            dg = abs((ang(a) - gv + math.pi / 2) % math.pi - math.pi / 2)
            if dg > angtol:
                continue
            if best is None or d < best[0]:
                best = (d, j)
        if best:
            nxt[i] = best[1]
    prev = {j: i for i, j in nxt.items()}
    used = set()
    chains = []
    for i in range(n):
        if i in prev or i in used:
            continue
        ch = [i]
        used.add(i)
        while ch[-1] in nxt and nxt[ch[-1]] not in used:
            ch.append(nxt[ch[-1]])
            used.add(ch[-1])
        chains.append(ch)
    out = list(rest)
    for ch in chains:
        if len(ch) >= min_count:
            a, b = short[ch[0]], short[ch[-1]]
            out.append((a[0], a[1], b[2], b[3]))
        else:
            out.extend(short[i] for i in ch)
    return out


def build_track_graph(segs: list[Seg], area, min_component=200.0, spur_len=4.0, contract_len=2.6) -> TrackGraph:
    cand = [_norm(s) for s in segs if is_track_candidate(s, area)]
    lines = merge_collinear(chain_dashes(merge_collinear(cand)))
    # puntos de corte: extremos de otras líneas que caen en el interior
    cuts = defaultdict(list)
    for i, a in enumerate(lines):
        for j, b in enumerate(lines):
            if i == j:
                continue
            for (px, py) in ((b[0], b[1]), (b[2], b[3])):
                d, t = point_seg_dist(px, py, *a)
                if d <= 0.7 and 0.0 < t < 1.0:
                    L = math.hypot(a[2] - a[0], a[3] - a[1])
                    if t * L > 0.7 and (1 - t) * L > 0.7:
                        cuts[i].append(t)
    g = TrackGraph()
    pieces = []
    for i, a in enumerate(lines):
        ts = sorted(set([0.0, 1.0] + [round(t, 6) for t in cuts[i]]))
        for t0, t1 in zip(ts, ts[1:]):
            if t1 - t0 < 1e-6:
                continue
            p0 = (a[0] + t0 * (a[2] - a[0]), a[1] + t0 * (a[3] - a[1]))
            p1 = (a[0] + t1 * (a[2] - a[0]), a[1] + t1 * (a[3] - a[1]))
            pieces.append((p0, p1))
    for p0, p1 in pieces:
        a = g.node_id(*p0)
        b = g.node_id(*p1)
        if a == b:
            continue
        g.edges.append(dict(a=a, b=b, pts=[g.nodes[a], g.nodes[b]]))
    # filtrar componentes pequeñas
    adj = defaultdict(list)
    for k, e in enumerate(g.edges):
        adj[e['a']].append(k)
        adj[e['b']].append(k)
    seen = set()
    keep = set()
    for k in range(len(g.edges)):
        if k in seen:
            continue
        stack = [k]
        comp = []
        while stack:
            e = stack.pop()
            if e in seen:
                continue
            seen.add(e)
            comp.append(e)
            for n in (g.edges[e]['a'], g.edges[e]['b']):
                stack.extend(adj[n])
        tot = sum(math.dist(g.edges[e]['pts'][0], g.edges[e]['pts'][1]) for e in comp)
        if tot >= min_component:
            keep.update(comp)
    g.edges = [e for k, e in enumerate(g.edges) if k in keep]
    dedupe(g)
    contract_short(g, min_len=contract_len)
    dedupe(g)
    prune_spurs(g, max_len=spur_len)
    merge_deg2_collinear(g)
    compact(g)
    # cruces propios (diamantes) entre aristas finales: se registran pero no se conectan
    for i, a in enumerate(g.edges):
        pa = (*a['pts'][0], *a['pts'][1])
        for b in g.edges[i + 1:]:
            pb = (*b['pts'][0], *b['pts'][1])
            r = seg_intersection(pa, pb)
            if r and 0.02 < r[2] < 0.98 and 0.02 < r[3] < 0.98:
                g.crossings.append((r[0], r[1]))
    return g


def prune_spurs(g: TrackGraph, max_len=4.0):
    """Elimina iterativamente aristas colgantes cortas (trazos de símbolos que tocan la vía)."""
    changed = True
    while changed:
        changed = False
        deg = g.degree()
        keep = []
        for e in g.edges:
            L = math.dist(e['pts'][0], e['pts'][1])
            if L < max_len and (deg[e['a']] == 1 or deg[e['b']] == 1) and not (deg[e['a']] == 1 and deg[e['b']] == 1 and L >= 2):
                changed = True
                continue
            keep.append(e)
        g.edges = keep


def compact(g: TrackGraph):
    used = sorted({e['a'] for e in g.edges} | {e['b'] for e in g.edges})
    remap = {o: i for i, o in enumerate(used)}
    g.nodes = [g.nodes[o] for o in used]
    for e in g.edges:
        e['a'] = remap[e['a']]
        e['b'] = remap[e['b']]


def dedupe(g: TrackGraph):
    seen = set()
    out = []
    for e in g.edges:
        if e['a'] == e['b']:
            continue
        k = (min(e['a'], e['b']), max(e['a'], e['b']))
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    g.edges = out


def contract_short(g: TrackGraph, min_len=2.6):
    """Contrae aristas muy cortas (trazos del símbolo de aguja) uniendo sus nodos."""
    parent = list(range(len(g.nodes)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in g.edges:
        if math.dist(g.nodes[e['a']], g.nodes[e['b']]) < min_len:
            ra, rb = find(e['a']), find(e['b'])
            if ra != rb:
                parent[rb] = ra
    groups = defaultdict(list)
    for i in range(len(g.nodes)):
        groups[find(i)].append(i)
    longest = defaultdict(float)
    for e in g.edges:
        L = math.dist(g.nodes[e['a']], g.nodes[e['b']])
        for n in (e['a'], e['b']):
            longest[n] = max(longest[n], L)
    newpos = {}
    for r, members in groups.items():
        if len(members) == 1:
            continue
        # posición: el extremo de la arista más larga del grupo (mantiene rectas las vías principales)
        best = max(members, key=lambda m: (longest[m], -m))
        newpos[r] = g.nodes[best]
    for r, pos in newpos.items():
        g.nodes[r] = pos
    for e in g.edges:
        e['a'] = find(e['a'])
        e['b'] = find(e['b'])
        e['pts'] = [g.nodes[e['a']], g.nodes[e['b']]]
    g.edges = [e for e in g.edges if e['a'] != e['b']]


def merge_deg2_collinear(g: TrackGraph, angtol=0.02):
    """Fusiona aristas consecutivas colineales unidas por un nodo de grado 2."""
    changed = True
    while changed:
        changed = False
        deg = g.degree()
        inc = defaultdict(list)
        for k, e in enumerate(g.edges):
            inc[e['a']].append(k)
            inc[e['b']].append(k)
        for n, ks in inc.items():
            if deg[n] != 2 or len(ks) != 2:
                continue
            e1, e2 = g.edges[ks[0]], g.edges[ks[1]]
            o1 = e1['b'] if e1['a'] == n else e1['a']
            o2 = e2['b'] if e2['a'] == n else e2['a']
            p, q, r = g.nodes[o1], g.nodes[n], g.nodes[o2]
            a1 = math.atan2(q[1] - p[1], q[0] - p[0])
            a2 = math.atan2(r[1] - q[1], r[0] - q[0])
            if abs((a1 - a2 + math.pi) % (2 * math.pi) - math.pi) < angtol and o1 != o2:
                newe = dict(a=o1, b=o2, pts=[g.nodes[o1], g.nodes[o2]])
                g.edges = [e for k, e in enumerate(g.edges) if k not in ks] + [newe]
                changed = True
                break
