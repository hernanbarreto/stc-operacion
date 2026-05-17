#!/usr/bin/env python3
"""
Extractor de curvas de velocidad Siemens (PNG -> JSON + PNG validacion).

Uso:
    python3 extract_curve.py <chart.png>
    python3 extract_curve.py <chart.png> --pk-min 0.6 --pk-max 2.0
    python3 extract_curve.py imagenes\\ operacion/NM16_V1_5300-5940.png

El rango de PK se autodetecta del nombre del archivo (ej. "NM16_V1_5300-5940.png"
=> PK 5.300 a 5.940 km). Pase --pk-min/--pk-max para anular.

Salidas (mismo directorio que la entrada):
    <basename>_curva.json    Curva suavizada (pk_km, v_kmh, a_ms2) cada 1 m
    <basename>_RENDER.png    Render limpio de la curva (canvas blanco)
    <basename>_OVERLAY.png   Curva azul superpuesta sobre el grafico original
"""
import argparse
import json
import re
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from scipy.signal import savgol_filter
from scipy.interpolate import PchipInterpolator


# ============================================================================
# 1) DETECCION DEL PLOT FRAME
# ============================================================================
def detect_plot_frame(arr):
    """Retorna (L, R, T, B) del PLOT INTERIOR.

    Estrategia:
      - L y R: detectar EJES VERTICALES (lineas largas verticales) excluyendo el marco exterior
      - B: detectar EJE HORIZONTAL INFERIOR (linea larga horizontal) excluyendo marco exterior
      - T: derivado del topmost grid line horizontal (cada 10 km/h del eje Y)
    """
    gray = arr.mean(axis=2)
    dark = gray < 200
    H, W = gray.shape

    # Detectar runs largos
    horiz_rows = []
    for rr in range(H):
        if max_run(dark[rr]) > W * 0.5:
            horiz_rows.append(rr)
    vert_cols = []
    for cc in range(W):
        if max_run(dark[:, cc]) > H * 0.5:
            vert_cols.append(cc)

    def cluster_centers(lst, gap=3):
        if not lst: return []
        cl = [lst[0]]; out = []
        for x in lst[1:]:
            if x - cl[-1] <= gap: cl.append(x)
            else: out.append(int(np.mean(cl))); cl = [x]
        out.append(int(np.mean(cl)))
        return out

    hs = cluster_centers(horiz_rows, gap=5)
    vs = cluster_centers(vert_cols, gap=5)

    # Excluir bordes muy externos (probable marco de pagina)
    edge_h = max(8, int(H * 0.02))
    edge_w = max(8, int(W * 0.02))
    hs_inner = [r for r in hs if r > edge_h and r < H - edge_h]
    vs_inner = [c for c in vs if c > edge_w and c < W - edge_w]

    if not vs_inner: vs_inner = vs
    if not hs_inner: hs_inner = hs

    # vs_inner ya excluye los bordes pegados a la imagen.
    # L = min, R = max (los extremos interiores).
    L = min(vs_inner)
    R = max(vs_inner)

    # Para H: distinguir T (techo del plot) de B (piso del plot).
    # Si tenemos varios candidatos en la mitad inferior, B es el MAS INTERIOR (menor row).
    # Top: si hay candidatos arriba, T = max de ellos (mas interior).
    hs_sorted = sorted(hs_inner)
    candidates_top = [rr for rr in hs_sorted if rr < H * 0.4]
    candidates_bot = [rr for rr in hs_sorted if rr > H * 0.4]
    T = max(candidates_top) if candidates_top else None
    B = min(candidates_bot) if candidates_bot else max(hs_sorted)

    if T is None:
        T = detect_top_grid(arr, L, R, B)
    return L, R, T, B


def detect_top_grid(arr, L, R, B):
    """Encuentra el row del topmost grid horizontal (lineas grises tipo 224,224,224)."""
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    grid_mask = (np.abs(r - 224) < 14) & (np.abs(g - 224) < 14) & (np.abs(b - 224) < 14)
    sub = grid_mask[:, L+2:R-1]
    row_sum = sub.sum(axis=1)
    threshold = (R - L) * 0.5
    grid_rows = [rr for rr in range(arr.shape[0]) if row_sum[rr] > threshold and rr < B]
    if not grid_rows: return 40
    # Cluster
    cl = [grid_rows[0]]; centers = []
    for x in grid_rows[1:]:
        if x - cl[-1] <= 2: cl.append(x)
        else: centers.append(int(np.mean(cl))); cl = [x]
    centers.append(int(np.mean(cl)))
    return min(centers)


def max_run(bool_arr):
    best = cur = 0
    for v in bool_arr:
        if v:
            cur += 1; best = max(best, cur)
        else:
            cur = 0
    return best


# ============================================================================
# 2) CALIBRACION X (PK) usando labels detectados o filename
# ============================================================================
def detect_x_labels(arr, B, L, R):
    """Detecta centros de columnas de los labels de PK debajo del eje X."""
    gray = arr.mean(axis=2)
    # Banda de texto: justo debajo de B (row del eje x)
    band_top = B + 6
    band_bot = B + 20
    if band_bot >= gray.shape[0]:
        band_bot = gray.shape[0] - 1
    band = (gray[band_top:band_bot] < 150).any(axis=0)
    cols_with = np.where(band)[0]
    if len(cols_with) == 0:
        return []
    groups = []
    cur = [cols_with[0]]
    for c in cols_with[1:]:
        if c - cur[-1] <= 4:
            cur.append(c)
        else:
            groups.append(cur); cur = [c]
    groups.append(cur)
    # Solo grupos de ancho >= 5 (labels completos, no fragmentos)
    centers = [int(np.mean(g)) for g in groups if (g[-1] - g[0]) >= 5]
    # Filtrar dentro del plot
    centers = [c for c in centers if L - 30 <= c <= R + 30]
    return centers


def calibrate_x(arr, B, L, R, pk_min, pk_max):
    """Devuelve funcion col_to_pk(c) calibrada."""
    labels = detect_x_labels(arr, B, L, R)
    if len(labels) >= 3:
        # Asumimos ticks uniformes entre pk_min y pk_max
        labels.sort()
        # Estimacion: primer label = pk_min, ultimo label = pk_max
        # Mejorada: hacer regresion asumiendo ticks equiespaciados cada 0.1 km (lo tipico Siemens)
        # Detectar spacing
        spacings = np.diff(labels)
        med_sp = float(np.median(spacings))
        # Saltos grandes indican labels faltantes
        n_ticks_expected = int(round((pk_max - pk_min) * 10)) + 1
        # Mapeo: si tenemos N labels equiespaciados con spacing med_sp,
        # y el primero es pk_min, entonces label_i = pk_min + i*0.1
        # Asumimos el PRIMER label visible es el del PK mas chico
        col_first = labels[0]
        col_last = labels[-1]
        # Cantidad de tick steps (0.1km) entre primer y ultimo label detectado:
        n_steps = round((col_last - col_first) / med_sp)
        pk_first = pk_min
        pk_last  = pk_min + n_steps * 0.1
        # Si pk_last sale mayor a pk_max, ajustar (probable que detection caso particular)
        if pk_last > pk_max + 0.05:
            pk_last = pk_max
        def col_to_pk(c, _f=col_first, _l=col_last, _pf=pk_first, _pl=pk_last):
            return _pf + (c - _f) / (_l - _f) * (_pl - _pf)
        return col_to_pk, (col_first, col_last, pk_first, pk_last)
    # Fallback: usar bordes del plot
    def col_to_pk(c, _L=L, _R=R, _pm=pk_min, _pM=pk_max):
        return _pm + (c - _L) / (_R - _L) * (_pM - _pm)
    return col_to_pk, (L, R, pk_min, pk_max)


# ============================================================================
# 3) CALIBRACION Y (V) detectando ticks horizontales
# ============================================================================
def calibrate_y(arr, T, B, L, R, v_max_assumed=120):
    """Detecta grid lines horizontales para calibrar el eje Y de velocidad.

    Asume grid cada 10 km/h. v=0 se ancla a row B (eje X del plot).
    El topmost grid corresponde a v_top = (cantidad de grids visibles) * 10
    si el bottommost grid esta separado de B por aprox 1 spacing (v=10 no esta en B).
    Si el bottommost grid coincide con B, v_top = (cantidad-1)*10.
    """
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    grid_mask = (np.abs(r - 224) < 14) & (np.abs(g - 224) < 14) & (np.abs(b - 224) < 14)
    plot_grid = grid_mask[:, L+2:R-1]
    row_sum = plot_grid.sum(axis=1)
    grid_rows = []
    for row in range(T, B):
        if row_sum[row] > (R - L) * 0.5:
            grid_rows.append(row)
    if not grid_rows:
        def row_to_v(rr, _B=B, _T=T, _vm=v_max_assumed): return (_B - rr) / (_B - _T) * _vm
        return row_to_v, (T, B, v_max_assumed)
    groups = []
    cur = [grid_rows[0]]
    for rr in grid_rows[1:]:
        if rr - cur[-1] <= 2:
            cur.append(rr)
        else:
            groups.append(int(np.mean(cur))); cur = [rr]
    groups.append(int(np.mean(cur)))

    spacings = np.diff(groups)
    med_sp = float(np.median(spacings))
    n_grids = len(groups)
    lowest_grid = groups[-1]
    topmost_grid = groups[0]

    # ¿v=0 esta en uno de los grids o en B?
    # Si (B - lowest_grid) > 0.5*med_sp -> v=0 NO esta en grids, esta en B
    # En ese caso, v_top = n_grids * 10 (grids estan en v=10, 20, ..., v_top)
    if (B - lowest_grid) > med_sp * 0.5:
        row_v0 = B
        v_top = n_grids * 10
    else:
        row_v0 = lowest_grid
        v_top = (n_grids - 1) * 10

    def row_to_v(rr, _rv0=row_v0, _rvm=topmost_grid, _vt=v_top):
        return (_rv0 - rr) / (_rv0 - _rvm) * _vt
    return row_to_v, (topmost_grid, row_v0, v_top)


# ============================================================================
# 4) EXTRACCION DE LA CURVA (color filtrado + tracking)
# ============================================================================
def extract_curve_pixels(arr, T, B, L, R):
    """Devuelve dict col -> row con el trace de velocidad."""
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    # Velocidad: brown/dark-red (R > G > B), excluyendo poligono olive-gray (R <= G)
    brown_red = ((r - g) >= 5) & ((g - b) >= -5) & ((g - b) <= 30) & (r > 80) & (r < 230)
    warm_dark = ((r - b) >= 25) & ((g - b) >= 0) & ((g - b) <= 40) & (r > 90) & (r < 220) & ((r - g) > 0)
    mask = brown_red | warm_dark

    # Limit plot area (excluir bordes)
    H, W = arr.shape[:2]
    mask[:T+5, :] = False
    mask[B-1:, :] = False
    mask[:, :L+2] = False
    mask[:, R-1:] = False

    def clusters(c):
        rows = np.where(mask[:, c])[0]
        if len(rows) == 0: return []
        out = []; cur = [rows[0]]
        for rr in rows[1:]:
            if rr - cur[-1] <= 3: cur.append(rr)
            else: out.append(cur); cur = [rr]
        out.append(cur)
        return out

    # Encontrar primera col con detection
    start_c = None
    for c in range(L, R):
        if clusters(c): start_c = c; break
    if start_c is None:
        return {}

    track = {}
    prev = None
    for c in range(start_c, R):
        cls = clusters(c)
        if not cls: continue
        if prev is None:
            best = max(cls, key=lambda cc: cc[-1])  # cluster mas bajo
            prev = int(np.median(best))
        else:
            def score(cc):
                mid = int(np.median(cc))
                return abs(mid - prev) - len(cc) * 1.5
            best = sorted(cls, key=score)[0]
            prev = int(np.median(best))
        track[c] = prev
    return track


def find_curve_endpoints(track, row_to_v, B):
    """Localiza inicio y fin de la curva real (v=0 en ambos extremos del fenomeno)."""
    items = sorted(track.items())
    if not items: return None, None
    # Inicio: el primer col del tracking
    start_c = items[0][0]

    # Fin: en la SEGUNDA mitad, el col donde el row es MAXIMO (=v min) por primera vez
    # despues del peak de pre-frenado. Truncar despues del primer min para evitar rebotes.
    cols = [c for c, _ in items]
    rows = [r for _, r in items]
    n = len(items)
    half = n // 2
    # Buscar la zona de frenado: a partir de la 2da mitad, buscar el primer row >= max_row_post
    max_row_so_far = 0
    end_c = items[-1][0]
    for i in range(half, n):
        c, rr = items[i]
        if rr > max_row_so_far:
            max_row_so_far = rr
            end_c = c
    return start_c, end_c


# ============================================================================
# 5) SUAVIZADO Y DERIVADAS
# ============================================================================
def smooth_and_derive(pk_raw, v_raw, dx=0.001, sg_window=21, sg_poly=3):
    """Resample a paso uniforme + Savitzky-Golay + derivadas fisicas."""
    order = np.argsort(pk_raw)
    pk_raw = pk_raw[order]
    v_raw  = v_raw[order]
    _, idx = np.unique(pk_raw, return_index=True)
    idx.sort()
    pk_raw = pk_raw[idx]
    v_raw  = v_raw[idx]
    # Resample
    pk_u = np.arange(pk_raw[0], pk_raw[-1] + dx/2, dx)
    pchip = PchipInterpolator(pk_raw, v_raw)
    v_u = pchip(pk_u)
    # SG
    if len(v_u) >= sg_window:
        v_sg = savgol_filter(v_u, sg_window, sg_poly)
    else:
        v_sg = v_u.copy()
    v_sg = np.maximum(v_sg, 0)
    v_sg[0]  = 0.0
    v_sg[-1] = 0.0
    # Smooth blending edges
    EDGE = 5
    for i in range(1, EDGE):
        w = i / EDGE
        v_sg[i]    = w * v_sg[EDGE]    + (1-w) * 0
        v_sg[-1-i] = w * v_sg[-EDGE-1] + (1-w) * 0
    # Derivadas
    v_ms = v_sg / 3.6
    pk_m = pk_u * 1000
    dvdx = np.gradient(v_ms, pk_m)
    a = v_ms * dvdx
    return pk_u, v_sg, a


# ============================================================================
# 6) RENDER
# ============================================================================
def render_clean(pk_u, v_sg, out_path, title, pk_min, pk_max, v_max):
    W, H = 1200, 700
    img = Image.new('RGB', (W, H), 'white')
    draw = ImageDraw.Draw(img)
    try:
        fnt = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11)
        fbold = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
    except Exception:
        fnt = ImageFont.load_default(); fbold = fnt

    L, R, T, B = 90, 1150, 50, 630
    pk_range = pk_max - pk_min
    pad = pk_range * 0.03
    px_min = pk_min - pad
    px_max = pk_max + pad
    def x(p): return L + (p - px_min)/(px_max - px_min) * (R - L)
    def y(v): return B - v / v_max * (B - T)
    draw.rectangle([L, T, R, B], outline='black')
    # Grid Y
    step_v = 10
    for vv in range(0, int(v_max) + 1, step_v):
        yy = y(vv)
        draw.line([L, yy, R, yy], fill=(225,225,225))
        draw.text((L-30, yy-7), str(vv), fill='black', font=fnt)
    # Grid X
    step_pk = 0.1 if pk_range <= 3 else 0.2
    pk = round(pk_min, 4)
    while pk <= pk_max + 1e-6:
        xx = x(pk)
        draw.line([xx, T, xx, B], fill=(232,232,232))
        draw.text((xx-12, B+5), f'{pk:.2f}'.rstrip('0').rstrip('.'), fill='black', font=fnt)
        pk = round(pk + step_pk, 3)
    # Curve
    prev = None
    for i in range(len(pk_u)):
        xx, yy = x(pk_u[i]), y(v_sg[i])
        if prev is not None:
            draw.line([prev, (xx, yy)], fill=(0,80,200), width=2)
        prev = (xx, yy)
    draw.text((W//2 - 100, 18), title, fill='black', font=fbold)
    draw.text((W//2 - 30, B+25), 'PK [km]', fill='black', font=fbold)
    draw.text((15, T+30), 'V [km/h]', fill='black', font=fbold)
    img.save(out_path)


def render_overlay(src_path, pk_u, v_sg, col_to_pk_inv, v_to_row_inv, out_path):
    """Render azul sobre la imagen original."""
    img = Image.open(src_path).convert('RGB')
    draw = ImageDraw.Draw(img)
    prev = None
    for i in range(len(pk_u)):
        c = col_to_pk_inv(pk_u[i])
        r = v_to_row_inv(v_sg[i])
        pt = (int(round(c)), int(round(r)))
        if prev is not None:
            draw.line([prev, pt], fill=(0,100,255), width=2)
        prev = pt
    img.save(out_path)


# ============================================================================
# 7) MAIN
# ============================================================================
def parse_pk_from_filename(stem):
    """De 'NM16_V1_5300-5940' devuelve (5.300, 5.940)."""
    m = re.search(r'(\d+)-(\d+)', stem)
    if not m: return None, None
    a = int(m.group(1)); b = int(m.group(2))
    # asumir metros si >= 100 o km si < 10
    if a > 100:
        return a/1000.0, b/1000.0
    return float(a), float(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input', help='Ruta al PNG del chart Siemens')
    ap.add_argument('--pk-min', type=float, default=None)
    ap.add_argument('--pk-max', type=float, default=None)
    ap.add_argument('--v-max', type=float, default=120, help='Vmax del eje Y (default 120)')
    ap.add_argument('--sg-window', type=int, default=21, help='Ventana Savitzky-Golay en m (default 21)')
    ap.add_argument('--sg-poly', type=int, default=3)
    args = ap.parse_args()

    src = Path(args.input)
    if not src.is_file():
        print(f'ERROR: archivo no encontrado: {src}', file=sys.stderr); sys.exit(1)

    # PK range
    pk_min, pk_max = args.pk_min, args.pk_max
    if pk_min is None or pk_max is None:
        pm, pM = parse_pk_from_filename(src.stem)
        if pm is None:
            print('ERROR: no se pudo inferir PK del nombre, pasar --pk-min y --pk-max', file=sys.stderr)
            sys.exit(1)
        pk_min, pk_max = pm, pM
    print(f'Imagen:    {src}')
    print(f'PK range:  {pk_min:.4f} - {pk_max:.4f} km')

    # Cargar
    img = Image.open(src).convert('RGB')
    arr = np.array(img).astype(int)

    # Plot frame
    L, R, T, B = detect_plot_frame(arr)
    print(f'Plot frame: L={L} R={R} T={T} B={B}')

    # Calibracion Y
    row_to_v, y_cal = calibrate_y(arr, T, B, L, R, v_max_assumed=args.v_max)
    print(f'Y cal: row(v=0)={y_cal[1]} row(v={y_cal[2]})={y_cal[0]}')

    # Calibracion X
    col_to_pk, x_cal = calibrate_x(arr, B, L, R, pk_min, pk_max)
    print(f'X cal: col[{x_cal[0]}]=PK {x_cal[2]:.3f}  col[{x_cal[1]}]=PK {x_cal[3]:.3f}')

    # Extraccion
    track = extract_curve_pixels(arr, T, B, L, R)
    print(f'Tracking: {len(track)} columnas con curva')
    if not track:
        print('ERROR: no se detecto la curva. Revisar mascara de color.', file=sys.stderr); sys.exit(1)

    # Recortar a inicio/fin v=0
    start_c, end_c = find_curve_endpoints(track, row_to_v, B)
    track = {c: rr for c, rr in track.items() if start_c <= c <= end_c}
    # Anclar extremos a v=0 (row del bottom)
    row_v0 = y_cal[1]
    track[start_c] = row_v0
    track[end_c]   = row_v0
    print(f'Curva real: col {start_c} (PK {col_to_pk(start_c):.4f}) -> col {end_c} (PK {col_to_pk(end_c):.4f})')

    # Filtro mediana 3
    items = sorted(track.items())
    rs = [rr for _, rr in items]
    f = list(rs)
    for i in range(1, len(rs)-1):
        f[i] = sorted([rs[i-1], rs[i], rs[i+1]])[1]
    for (i, (c, _)) in enumerate(items):
        track[c] = f[i]
    track[start_c] = row_v0; track[end_c] = row_v0

    pk_raw = np.array([col_to_pk(c) for c, _ in sorted(track.items())])
    v_raw  = np.array([max(0.0, row_to_v(rr)) for _, rr in sorted(track.items())])

    # Suavizado
    pk_u, v_sg, a = smooth_and_derive(pk_raw, v_raw, dx=0.001,
                                      sg_window=args.sg_window, sg_poly=args.sg_poly)

    # === OUTPUTS ===
    out_dir = src.parent
    base = src.stem
    json_out    = out_dir / f'{base}_curva.json'
    render_out  = out_dir / f'{base}_RENDER.png'
    overlay_out = out_dir / f'{base}_OVERLAY.png'

    # JSON
    data = []
    for i in range(len(pk_u)):
        data.append({
            'pk_km': round(float(pk_u[i]), 4),
            'v_kmh': round(float(v_sg[i]), 3),
            'a_ms2': round(float(a[i]), 4),
        })
    with open(json_out, 'w') as f:
        json.dump(data, f, indent=1)

    # Render clean
    render_clean(pk_u, v_sg, render_out, title=base.replace('_', ' '),
                 pk_min=pk_min, pk_max=pk_max, v_max=y_cal[2])

    # Overlay
    def pk_to_col(pk, _f=x_cal[0], _l=x_cal[1], _pf=x_cal[2], _pl=x_cal[3]):
        return _f + (pk - _pf)/(_pl - _pf) * (_l - _f)
    def v_to_row(v, _rv0=y_cal[1], _rvm=y_cal[0], _vt=y_cal[2]):
        return _rv0 - v/_vt * (_rv0 - _rvm)
    render_overlay(src, pk_u, v_sg, pk_to_col, v_to_row, overlay_out)

    print(f'\nSalidas:')
    print(f'  JSON:    {json_out}  ({len(data)} puntos a 1m)')
    print(f'  Render:  {render_out}')
    print(f'  Overlay: {overlay_out}')
    print(f'\nV max digit: {v_sg.max():.2f} km/h')
    print(f'a max:       {a.max():.3f} m/s² (acel)  |  {a.min():.3f} m/s² (desac)')


if __name__ == '__main__':
    main()
