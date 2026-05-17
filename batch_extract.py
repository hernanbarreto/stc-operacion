#!/usr/bin/env python3
"""
Procesador en lote de curvas Siemens Línea 1 STC.

Uso:
    python3 batch_extract.py <directorio_con_pngs>

Por cada PNG en el directorio:
 1. Lee el TÍTULO con tesseract OCR (material + 2 estaciones + flecha de dirección)
 2. Aplica la convención: "A ← B" => tren va de B a A (flecha apunta al destino)
 3. Determina V1 (sentido PAN→OBS, PK creciente) o V2 (OBS→PAN, PK decreciente)
 4. Usa los PK de las estaciones del catalogo interno para calibrar el eje X
 5. Digitaliza la curva (color filtrado + tracking + suavizado SG)
 6. Guarda:  <out>/<MATERIAL>_<VIA>_<FROM>-<TO>.json
             <out>/<MATERIAL>_<VIA>_<FROM>-<TO>_RENDER.png
             <out>/<MATERIAL>_<VIA>_<FROM>-<TO>_OVERLAY.png

Genera también un manifiesto: batch_manifest.csv (resumen tabular).
"""
import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import pytesseract
from scipy.signal import savgol_filter
from scipy.interpolate import PchipInterpolator


# =============================================================================
# CATALOGO DE ESTACIONES (codigo, nombre, PK_km)
# =============================================================================
# PKs OFICIALES del plano de via (mismo sistema que el diagrama de hilo / stationPK.ts)
STATIONS = [
    ('PAN', 'Pantitlán',                  0.650),
    ('ZAR', 'Zaragoza',                   2.117798),
    ('GOM', 'Gómez Farías',               3.029863),
    ('BPA', 'Boulevard Puerto Aéreo',     3.790228),
    ('BAL', 'Balbuena',                   4.535736),
    ('MOC', 'Moctezuma',                  5.389045),
    ('SLA', 'San Lázaro',                 6.015849),
    ('CAN', 'Candelaria',                 7.036776),
    ('MER', 'Merced',                     7.881872),
    ('PIN', 'Pino Suárez',                8.776772),
    ('ISA', 'Isabel la Católica',         9.309249),
    ('SAL', 'Salto del Agua',             9.902240),
    ('BAD', 'Balderas',                  10.512010),
    ('CUA', 'Cuauhtémoc',                11.070800),
    ('INS', 'Insurgentes',               12.013590),
    ('SEV', 'Sevilla',                   12.808040),
    ('CHP', 'Chapultepec',               13.458740),
    ('JNA', 'Juanacatlán',               14.583120),
    ('TCY', 'Tacubaya',                  15.890670),
    ('OBS', 'Observatorio',              17.300600),
]
STATION_BY_CODE = {s[0]: s for s in STATIONS}


def normalize(s):
    s = unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode().lower()
    s = re.sub(r'[^a-z0-9]', '', s)
    return s


# Indice de nombres normalizados para fuzzy match
STATION_NORM = {normalize(s[1]): s[0] for s in STATIONS}


def match_station(name_text):
    """Encuentra el codigo de estacion mas similar al texto OCR."""
    nt = normalize(name_text)
    if not nt: return None
    # exact substring match
    candidates = []
    for norm, code in STATION_NORM.items():
        if nt in norm or norm in nt:
            candidates.append((code, abs(len(norm) - len(nt))))
    if candidates:
        candidates.sort(key=lambda x: x[1])
        return candidates[0][0]
    # fallback fuzzy: longest common substring
    best_code, best_score = None, 0
    for norm, code in STATION_NORM.items():
        # find longest prefix common
        common = sum(1 for a, b in zip(nt, norm) if a == b)
        if common > best_score:
            best_score = common; best_code = code
    return best_code if best_score >= 4 else None


# =============================================================================
# OCR de título
# =============================================================================
def parse_title(title_text):
    """De 'NM 16 Pantitlán <-- Zaragoza' devuelve (material, from, to).
    Convención: flecha apunta al DESTINO. 'A ← B' => tren B → A.
    """
    t = title_text.strip()
    # material
    mat_m = re.search(r'NM\s*(\d{2})', t, re.IGNORECASE)
    material = f'NM{mat_m.group(1)}' if mat_m else None

    # Encontrar flecha y separar
    arrow_left  = re.search(r'<\s*-+|←|<\s*=+', t)
    arrow_right = re.search(r'-+\s*>|→|=+\s*>', t)
    has_a = re.search(r'\s+a\s+', t)

    # extraer las dos estaciones (texto antes y después de flecha/separador)
    if arrow_left:
        parts = re.split(r'<\s*-+|←|<\s*=+', t, maxsplit=1)
        # flecha apunta al destino (izquierda) => parts[0] = destino, parts[1] = origen
        dest_text = parts[0]
        orig_text = parts[1] if len(parts) > 1 else ''
    elif arrow_right:
        parts = re.split(r'-+\s*>|→|=+\s*>', t, maxsplit=1)
        # flecha apunta al destino (derecha) => parts[1] = destino, parts[0] = origen
        orig_text = parts[0]
        dest_text = parts[1] if len(parts) > 1 else ''
    elif has_a:
        parts = re.split(r'\s+a\s+', t, maxsplit=1)
        orig_text = parts[0]
        dest_text = parts[1] if len(parts) > 1 else ''
    else:
        # fallback: extraer 2 nombres
        parts = re.split(r'[\s\-_,]+', t)
        # filtrar tokens cortos / numericos
        text_tokens = [p for p in parts if len(p) >= 3 and not p.isdigit() and not p.upper().startswith('NM')]
        orig_text = text_tokens[0] if text_tokens else ''
        dest_text = text_tokens[1] if len(text_tokens) > 1 else ''

    # Limpiar de "NM 16" si quedó pegado
    orig_text = re.sub(r'NM\s*\d+', '', orig_text, flags=re.IGNORECASE).strip()
    dest_text = re.sub(r'NM\s*\d+', '', dest_text, flags=re.IGNORECASE).strip()

    from_code = match_station(orig_text)
    to_code   = match_station(dest_text)

    return material, from_code, to_code


def determine_via(from_code, to_code):
    """V1 si from_PK < to_PK (PAN-side al OBS-side). V2 en caso contrario."""
    if from_code is None or to_code is None: return None
    pk_from = STATION_BY_CODE[from_code][2]
    pk_to   = STATION_BY_CODE[to_code][2]
    return 'V1' if pk_from < pk_to else 'V2'


# =============================================================================
# DETECCIÓN DE PLOT FRAME / CALIBRACIÓN (similar a extract_curve.py)
# =============================================================================
def max_run(bool_arr):
    best = cur = 0
    for v in bool_arr:
        if v: cur += 1; best = max(best, cur)
        else: cur = 0
    return best


def detect_plot_frame(arr):
    """Plot frame robusto: usa GRID LINES (color gris ~224) que solo existen dentro del plot.

    T = topmost grid line (v_max), B = bottommost grid + 1 spacing (v=0).
    L, R = lineas verticales largas dentro del rango Y del plot.
    """
    H, W = arr.shape[:2]
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    grid_mask = (np.abs(r - 224) < 14) & (np.abs(g - 224) < 14) & (np.abs(b - 224) < 14)
    row_sum = grid_mask.sum(axis=1)
    grid_rows = [rr for rr in range(H) if row_sum[rr] > W * 0.3]
    if not grid_rows or len(grid_rows) < 5:
        return _detect_frame_legacy(arr)
    # Cluster contiguos
    groups = []; cur = [grid_rows[0]]
    for x in grid_rows[1:]:
        if x - cur[-1] <= 2: cur.append(x)
        else: groups.append(int(np.mean(cur))); cur = [x]
    groups.append(int(np.mean(cur)))
    if len(groups) < 3:
        return _detect_frame_legacy(arr)
    spacings = np.diff(groups)
    med_sp = float(np.median(spacings))
    # Mantener solo grupos consistentes con la grilla periódica (filtra separadores de pie de pagina, etc.)
    keep = [groups[0]]
    for x in groups[1:]:
        d = x - keep[-1]
        if d <= med_sp * 2.5 and abs(d - med_sp * round(d / med_sp)) < med_sp * 0.4:
            keep.append(x)
    groups = keep
    T = groups[0]
    B = min(int(groups[-1] + med_sp), H - 1)
    # L, R dentro del rango [T, B]
    plot_band = arr[T:B+1, :]
    gray = plot_band.mean(axis=2); dark = gray < 200
    vert_lengths = dark.sum(axis=0)
    threshold = (B - T) * 0.7
    vert_cols = [c for c in range(W) if vert_lengths[c] > threshold]
    if vert_cols:
        cl = [vert_cols[0]]; vg = []
        for c in vert_cols[1:]:
            if c - cl[-1] <= 3: cl.append(c)
            else: vg.append(int(np.mean(cl))); cl = [c]
        vg.append(int(np.mean(cl)))
        L = min(vg); R = max(vg)
    else:
        L = 0; R = W - 1
    return L, R, T, B


def _detect_frame_legacy(arr):
    gray = arr.mean(axis=2); dark = gray < 200
    H, W = gray.shape
    horiz_rows = [r for r in range(H) if max_run(dark[r]) > W * 0.5]
    vert_cols  = [c for c in range(W) if max_run(dark[:, c]) > H * 0.5]
    def cc(lst, gap=5):
        if not lst: return []
        cl = [lst[0]]; out = []
        for x in lst[1:]:
            if x - cl[-1] <= gap: cl.append(x)
            else: out.append(int(np.mean(cl))); cl = [x]
        out.append(int(np.mean(cl))); return out
    hs = cc(horiz_rows); vs = cc(vert_cols)
    edge_h = max(8, int(H * 0.05)); edge_w = max(8, int(W * 0.02))
    hs_inner = [r for r in hs if edge_h < r < H - edge_h] or hs
    vs_inner = [c for c in vs if edge_w < c < W - edge_w] or vs
    L = min(vs_inner); R = max(vs_inner)
    candidates_top = [rr for rr in sorted(hs_inner) if rr < arr.shape[0] * 0.4]
    candidates_bot = [rr for rr in sorted(hs_inner) if rr > arr.shape[0] * 0.4]
    T = min(candidates_top) if candidates_top else 40
    B = min(candidates_bot) if candidates_bot else max(hs_inner)
    return L, R, T, B


def detect_top_grid(arr, L, R, B):
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    grid_mask = (np.abs(r - 224) < 14) & (np.abs(g - 224) < 14) & (np.abs(b - 224) < 14)
    sub = grid_mask[:, L+2:R-1]
    row_sum = sub.sum(axis=1)
    threshold = (R - L) * 0.5
    grid_rows = [rr for rr in range(arr.shape[0]) if row_sum[rr] > threshold and rr < B]
    if not grid_rows: return 40
    cl = [grid_rows[0]]; centers = []
    for x in grid_rows[1:]:
        if x - cl[-1] <= 2: cl.append(x)
        else: centers.append(int(np.mean(cl))); cl = [x]
    centers.append(int(np.mean(cl)))
    return min(centers)


def calibrate_y(arr, T, B, L, R):
    """Calibra eje Y. v=0 en row B (eje X). Detecta grid lines cada 10 km/h."""
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    grid_mask = (np.abs(r - 224) < 14) & (np.abs(g - 224) < 14) & (np.abs(b - 224) < 14)
    plot_grid = grid_mask[:, L+2:R-1]
    row_sum = plot_grid.sum(axis=1)
    grid_rows = [rr for rr in range(T, B) if row_sum[rr] > (R - L) * 0.5]
    if not grid_rows:
        v_max = 120
        def row_to_v(rr, _B=B, _T=T, _vm=v_max): return (_B - rr) / (_B - _T) * _vm
        return row_to_v, (T, B, v_max)
    cl = [grid_rows[0]]; groups = []
    for rr in grid_rows[1:]:
        if rr - cl[-1] <= 2: cl.append(rr)
        else: groups.append(int(np.mean(cl))); cl = [rr]
    groups.append(int(np.mean(cl)))
    med_sp = float(np.median(np.diff(groups))) if len(groups) > 1 else 43
    n_grids = len(groups)
    topmost, lowest = groups[0], groups[-1]
    if (B - lowest) > med_sp * 0.5:
        row_v0 = B; v_top = n_grids * 10
    else:
        row_v0 = lowest; v_top = (n_grids - 1) * 10
    def row_to_v(rr, _rv0=row_v0, _rvm=topmost, _vt=v_top):
        return (_rv0 - rr) / (_rv0 - _rvm) * _vt
    return row_to_v, (topmost, row_v0, v_top)


def calibrate_x_from_axis_ocr(img_pil, B, L, R, pk_from, pk_to):
    """Calibra X usando OCR de los labels del eje X + RANSAC para rechazar lecturas erroneas.

    Retorna funcion col_to_pk(c). Si OCR falla, usa fallback con estaciones.
    """
    import random
    try:
        crop = img_pil.crop((max(0, L - 30), B + 3, min(img_pil.width, R + 30), B + 30))
        if crop.width < 50 or crop.height < 5:
            raise ValueError("crop too small")
        SCALE = 5
        big = crop.resize((crop.width * SCALE, crop.height * SCALE), Image.LANCZOS)
        data = pytesseract.image_to_data(big, lang='spa', output_type=pytesseract.Output.DICT)
        labels = []
        x_offset = max(0, L - 30)
        pk_min_pl = min(pk_from, pk_to) - 0.3
        pk_max_pl = max(pk_from, pk_to) + 0.3
        for i in range(len(data['text'])):
            t = data['text'][i].strip()
            if not t: continue
            # Limpiar y reemplazar separadores varios
            t_norm = t.replace(',', '.').replace('/', '.').replace(' ', '')
            t_norm = re.sub(r'[^0-9.]', '', t_norm)
            if not t_norm: continue
            # Probar varias interpretaciones del numero
            candidates = []
            if '.' in t_norm:
                try: candidates.append(float(t_norm))
                except: pass
            # Probar insertar punto decimal en cada posicion (para casos donde OCR omitio coma)
            digits = t_norm.replace('.', '')
            for pos in range(1, len(digits)):
                try: candidates.append(float(digits[:pos] + '.' + digits[pos:]))
                except: pass
            # Tambien valor crudo
            try: candidates.append(float(t_norm))
            except: pass
            # Tomar el candidato dentro del rango plausible
            best_v = None
            for v in candidates:
                if pk_min_pl <= v <= pk_max_pl:
                    best_v = v; break
            if best_v is None: continue
            x_big = data['left'][i] + data['width'][i] / 2
            x_orig = x_offset + x_big / SCALE
            labels.append((x_orig, best_v))
        if len(labels) < 5:
            raise ValueError(f"too few labels: {len(labels)}")
        labels_arr = np.array(labels)
        cols_arr = labels_arr[:, 0]; pks_arr = labels_arr[:, 1]
        # RANSAC con pendiente positiva obligatoria y mínimo 5 inliers
        best_inliers = []
        best_slope = best_intercept = None
        for _ in range(1500):
            i = random.randrange(len(labels))
            j = random.randrange(len(labels))
            if i == j or abs(cols_arr[i] - cols_arr[j]) < 30: continue
            slope = (pks_arr[j] - pks_arr[i]) / (cols_arr[j] - cols_arr[i])
            # Restricciones físicas:
            #   slope > 0 (eje X siempre PK ascendente)
            #   slope dentro de rango razonable (0.0003 a 0.005 km/px)
            if slope < 0.0003 or slope > 0.005: continue
            intercept = pks_arr[i] - slope * cols_arr[i]
            pred = slope * cols_arr + intercept
            residuals = np.abs(pks_arr - pred)
            inliers = list(np.where(residuals < 0.005)[0])
            if len(inliers) > len(best_inliers):
                best_inliers = inliers; best_slope = slope; best_intercept = intercept
        if len(best_inliers) < 5:
            raise ValueError(f"RANSAC failed (only {len(best_inliers)} inliers)")
        # Refit con inliers
        ci = cols_arr[best_inliers]; pi = pks_arr[best_inliers]
        slope, intercept = np.polyfit(ci, pi, 1)
        def col_to_pk(c, _s=slope, _i=intercept):
            return _s * c + _i
        return col_to_pk, ('ocr', float(slope), float(intercept), len(best_inliers))
    except Exception as e:
        # Fallback: anclar curva endpoints a estaciones
        return None, ('fallback', str(e))


def calibrate_x_with_stations(arr, B, L, R, pk_from, pk_to):
    """Calibra eje X usando los PK conocidos de las 2 estaciones.
    Detecta labels del eje X y los mapea a pk_min, pk_max."""
    pk_min = min(pk_from, pk_to)
    pk_max = max(pk_from, pk_to)
    gray = arr.mean(axis=2)
    band = (gray[B+6:B+25] < 150).any(axis=0)
    cols_with = np.where(band)[0]
    if len(cols_with):
        groups = []; cur = [cols_with[0]]
        for c in cols_with[1:]:
            if c - cur[-1] <= 4: cur.append(c)
            else: groups.append(cur); cur = [c]
        groups.append(cur)
        centers = [int(np.mean(g)) for g in groups if (g[-1] - g[0]) >= 5 and L - 30 <= int(np.mean(g)) <= R + 30]
        if len(centers) >= 3:
            spacings = np.diff(sorted(centers))
            med_sp = float(np.median(spacings))
            col_first = min(centers); col_last = max(centers)
            n_steps = round((col_last - col_first) / med_sp)
            # asumir step = 0.1 km tipico Siemens. validar contra pk_max-pk_min
            estimated_pk_range = n_steps * 0.1
            actual_pk_range = pk_max - pk_min
            # Calibrar: si los labels detectados cubren un rango similar al esperado
            # asumimos primer label = PK del label visible mas bajo
            # Para encontrar que PK corresponde al primer label, usamos los labels equiespaciados
            # y que el rango total visible (incluyendo padding) >= rango entre estaciones
            # Estrategia: usar 2 labels conocidos por proximidad a estaciones
            # Asumiendo que la grafica cubre las 2 estaciones, el label mas chico esta a PK <= pk_min
            # y el mas grande a PK >= pk_max
            # Step = 0.1 km, calibrate por regresion lineal con suposicion de 0.1 step
            # col_to_pk(c) = pk0 + (c - col_first)/med_sp * 0.1
            # pk0 = primer label en km
            # Buscamos pk0 tal que la curva entre col_first y col_last quepa dentro de pk_min, pk_max
            # En la mayoria de Siemens, primer label = pk redondeado a 0.1 abajo de pk_min
            pk0_guess = round(pk_min - 0.1, 2)
            # iterar opciones cercanas
            best_pk0 = pk0_guess; best_err = 1e9
            for trial in [pk0_guess - 0.1, pk0_guess, pk0_guess + 0.1]:
                trial_max = trial + n_steps * 0.1
                # Distancia a abarcar pk_min y pk_max
                err = abs(trial - (pk_min - 0.05)) + abs(trial_max - (pk_max + 0.05))
                if err < best_err: best_err = err; best_pk0 = trial
            def col_to_pk(c, _cf=col_first, _ms=med_sp, _p0=best_pk0):
                return _p0 + (c - _cf) / _ms * 0.1
            return col_to_pk
    # Fallback: usar bordes del plot
    def col_to_pk(c, _L=L, _R=R, _pm=pk_min, _pM=pk_max):
        return _pm + (c - _L) / (_R - _L) * (_pM - _pm)
    return col_to_pk


# =============================================================================
# EXTRACCION + SUAVIZADO
# =============================================================================
def extract_curve_pixels(arr, T, B, L, R):
    r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
    # MASCARA ESTRICTA: solo brown verdadero (R>G+10, G-B<28). Excluye:
    #   - poligono olive-grey (R<=G)
    #   - elevation olive (G-B > 30)
    real_curve = ((r - g) >= 10) & ((g - b) >= -5) & ((g - b) <= 28) & \
                 ((r - b) >= 30) & (r > 80) & (r < 230)
    mask = real_curve
    mask[:T+5, :] = False; mask[B-1:, :] = False
    mask[:, :L+2] = False; mask[:, R-1:] = False

    def clusters(c):
        rows = np.where(mask[:, c])[0]
        if len(rows) == 0: return []
        out = []; cur = [rows[0]]
        for rr in rows[1:]:
            if rr - cur[-1] <= 3: cur.append(rr)
            else: out.append(cur); cur = [rr]
        out.append(cur); return out

    # Compute max row jump per col (≈8 km/h, depending on Y scale)
    max_jump = max(4, int((B - T) / 120 * 8))

    # Init: find first col with a SIGNIFICANT cluster (≥2 px). Tomar el cluster más bajo
    # (cerca de v=0) porque la curva siempre arranca/termina con v=0.
    start_c = None; init_prev = None
    for c in range(L, R):
        cls = [cc for cc in clusters(c) if len(cc) >= 2]
        if cls:
            # Tomar cluster con max row (más cerca de v=0 = más abajo en chart)
            best = max(cls, key=lambda cc: cc[-1])
            start_c = c
            init_prev = int(np.median(best))
            break
    if start_c is None: return {}

    track = {start_c: init_prev}
    prev = init_prev
    for c in range(start_c + 1, R):
        cls = clusters(c)
        if not cls:
            track[c] = prev   # mantener prev (interp)
            continue
        # Filtrar clusters dentro de max_jump
        feasible = [cc for cc in cls if abs(int(np.median(cc)) - prev) <= max_jump]
        if feasible:
            # Preferir cluster de mayor masa + más cercano a prev
            best = sorted(feasible, key=lambda cc: -len(cc) + abs(int(np.median(cc)) - prev) * 0.2)[0]
            prev = int(np.median(best))
        # Ninguno feasible: mantener prev (no saltar)
        track[c] = prev
    return track


def find_endpoints(track, B):
    items = sorted(track.items())
    if not items: return None, None
    start_c = items[0][0]
    half = len(items) // 2
    max_row = 0; end_c = items[-1][0]
    for i in range(half, len(items)):
        c, rr = items[i]
        if rr > max_row:
            max_row = rr; end_c = c
    return start_c, end_c


def smooth_curve(pk_raw, v_raw, pk_from, pk_to, dx=0.001, sg_window=21, sg_poly=3):
    """Resample a paso uniforme + SG.

    NO inserta v=0 fuera del rango digitalizado. Si el chart no alcanza la estacion,
    la curva queda con v>0 en ese extremo; el stitcher se encarga de cerrarlo.
    """
    order = np.argsort(pk_raw); pk_raw = pk_raw[order]; v_raw = v_raw[order]
    _, idx = np.unique(pk_raw, return_index=True); idx.sort()
    pk_raw = pk_raw[idx]; v_raw = v_raw[idx]
    pk_u = np.arange(pk_raw[0], pk_raw[-1] + dx/2, dx)
    pchip = PchipInterpolator(pk_raw, v_raw)
    v_u = pchip(pk_u)
    if len(v_u) >= sg_window:
        v_sg = savgol_filter(v_u, sg_window, sg_poly)
    else:
        v_sg = v_u.copy()
    v_sg = np.maximum(v_sg, 0)
    # Forzar v=0 exacto en los dos extremos (que estan en los PK de las 2 estaciones)
    v_sg[0] = 0.0
    v_sg[-1] = 0.0
    v_ms = v_sg / 3.6; pk_m = pk_u * 1000
    dvdx = np.gradient(v_ms, pk_m)
    a = v_ms * dvdx
    return pk_u, v_sg, a


# =============================================================================
# RENDER
# =============================================================================
def render_clean(pk_u, v_sg, out_path, title, pk_from, pk_to, v_max,
                 from_code=None, to_code=None):
    """Render canvas blanco con la curva.

    Marcadores de estación se ubican EXACTAMENTE en los endpoints de la curva
    (donde v=0), no en los PK nominales de tabla. Así marca y curva coinciden
    pixel-a-pixel en cada chart individual.
    """
    W, H = 1200, 700
    img = Image.new('RGB', (W, H), 'white')
    draw = ImageDraw.Draw(img)
    try:
        fnt = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 11)
        fbold = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
    except Exception:
        fnt = ImageFont.load_default(); fbold = fnt
    L, R, T, B = 90, 1150, 50, 630

    data_min = float(np.min(pk_u)); data_max = float(np.max(pk_u))
    pad = max(0.005, (data_max - data_min) * 0.03)
    px_min = data_min - pad; px_max = data_max + pad

    def x(p): return L + (p - px_min)/(px_max - px_min) * (R - L)
    def y(v): return B - v / v_max * (B - T)

    draw.rectangle([L, T, R, B], outline='black')

    for vv in range(0, int(v_max) + 1, 10):
        yy = y(vv)
        draw.line([L, yy, R, yy], fill=(225,225,225))
        draw.text((L-30, yy-7), str(vv), fill='black', font=fnt)

    rng = px_max - px_min
    if rng <= 1.5: step_pk = 0.05
    elif rng <= 3: step_pk = 0.1
    else: step_pk = 0.2
    pk_start = round(px_min / step_pk) * step_pk
    pk = pk_start
    while pk <= px_max + 1e-6:
        xx = x(pk)
        if L - 1 <= xx <= R + 1:
            draw.line([xx, T, xx, B], fill=(232,232,232))
            draw.text((xx-14, B+5), f'{pk:.3f}'.rstrip('0').rstrip('.'), fill='black', font=fnt)
        pk = round(pk + step_pk, 4)

    # Marcadores de FROM y TO ubicados en los endpoints REALES de la curva.
    # V1 (PK_from < PK_to): FROM en data_min, TO en data_max.
    # V2 (PK_from > PK_to): FROM en data_max, TO en data_min.
    if from_code and to_code:
        if pk_from < pk_to:
            from_pk_marker = data_min; to_pk_marker = data_max
        else:
            from_pk_marker = data_max; to_pk_marker = data_min
        for code, pk_m in [(from_code, from_pk_marker), (to_code, to_pk_marker)]:
            xx = x(pk_m)
            draw.line([xx, T, xx, B], fill=(50,150,50), width=2)
            # Texto adentro del plot, en el lado opuesto al borde
            tx = xx + 3 if xx < (L + R) / 2 else xx - 28
            draw.text((tx, T+5), code, fill=(0,100,0), font=fbold)

    prev = None
    for i in range(len(pk_u)):
        xx, yy = x(float(pk_u[i])), y(float(v_sg[i]))
        if prev is not None:
            draw.line([prev, (xx, yy)], fill=(0,80,200), width=2)
        prev = (xx, yy)

    draw.text((W//2 - 120, 18), title, fill='black', font=fbold)
    draw.text((W//2 - 30, B+25), 'PK [km]', fill='black', font=fbold)
    draw.text((15, T+30), 'V [km/h]', fill='black', font=fbold)
    img.save(out_path)


def render_overlay(src_path, pk_u, v_sg, pk_to_col_fn, v_to_row_fn, out_path):
    img = Image.open(src_path).convert('RGB')
    draw = ImageDraw.Draw(img)
    prev = None
    for i in range(len(pk_u)):
        c = pk_to_col_fn(pk_u[i]); r = v_to_row_fn(v_sg[i])
        pt = (int(round(c)), int(round(r)))
        if prev is not None: draw.line([prev, pt], fill=(0,100,255), width=2)
        prev = pt
    img.save(out_path)


# =============================================================================
# MAIN
# =============================================================================
def find_title_text(img):
    """Busca el titulo probando varios crops en zona top + zona arriba del plot frame."""
    # Primero detectar el plot frame para saber donde puede estar el titulo
    try:
        arr_tmp = np.array(img.convert('RGB')).astype(int)
        L, R, T, B = detect_plot_frame(arr_tmp)
    except Exception:
        T = 100
    # Pruebas de crop: zonas estandar y arriba del plot
    candidates = [
        (0, 0, img.width, 50),
        (0, 0, img.width, 100),
        (0, 0, img.width, max(T, 100)),     # toda zona sobre plot
        (0, max(0, T - 80), img.width, T),  # ventana justo arriba del plot
        (0, 0, img.width, max(T, 150)),
    ]
    best_text = ''; best_score = -1
    for box in candidates:
        try:
            crop = img.crop(box)
            txt = pytesseract.image_to_string(crop, lang='spa').strip()
            txt = ' '.join(txt.split())
            if not txt: continue
            # Heuristico: score = cantidad de estaciones que aparecen + 1 si hay 'NM'
            score = 0
            if re.search(r'NM\s*\d', txt, re.IGNORECASE): score += 2
            for _code, name, _pk in STATIONS:
                if name.split()[0].lower() in txt.lower(): score += 1
            if score > best_score:
                best_score = score; best_text = txt
        except Exception:
            continue
    return best_text


def process_one(src):
    img = Image.open(src).convert('RGB')
    arr = np.array(img).astype(int)
    # OCR título
    title_text = find_title_text(img)
    material, from_code, to_code = parse_title(title_text)
    via = determine_via(from_code, to_code)
    if not (material and from_code and to_code and via):
        return {'src': str(src), 'title': title_text, 'error': 'no se pudo parsear título'}

    pk_from = STATION_BY_CODE[from_code][2]
    pk_to   = STATION_BY_CODE[to_code][2]

    L, R, T, B = detect_plot_frame(arr)
    row_to_v_fn, y_cal = calibrate_y(arr, T, B, L, R)
    track = extract_curve_pixels(arr, T, B, L, R)
    if not track:
        return {'src': str(src), 'title': title_text, 'error': 'no se detectó curva'}
    start_c, end_c = find_endpoints(track, B)
    track = {c: rr for c, rr in track.items() if start_c <= c <= end_c}
    track[start_c] = y_cal[1]; track[end_c] = y_cal[1]
    items = sorted(track.items()); rs = [rr for _, rr in items]
    f = list(rs); W_med = 7
    for i in range(len(rs)):
        a = max(0, i - W_med//2); b = min(len(rs), i + W_med//2 + 1)
        f[i] = sorted(rs[a:b])[(b-a)//2]
    for i, (c, _) in enumerate(items): track[c] = f[i]
    track[start_c] = y_cal[1]; track[end_c] = y_cal[1]

    # CALIBRACION X: SIEMPRE usar la tabla de estaciones como verdad.
    # start_c (col mas izq de la curva) -> PK menor de las 2 estaciones
    # end_c   (col mas der de la curva) -> PK mayor
    # Esto garantiza que el mismo PK de estacion sea EXACTO en todos los charts.
    pk_st_min = min(pk_from, pk_to); pk_st_max = max(pk_from, pk_to)
    def col_to_pk_fn(c, _sc=start_c, _ec=end_c, _pmin=pk_st_min, _pmax=pk_st_max):
        if _ec == _sc: return _pmin
        return _pmin + (c - _sc) / (_ec - _sc) * (_pmax - _pmin)
    x_cal_meta = ('anclado-tabla-estaciones', None)

    pk_raw = np.array([col_to_pk_fn(c) for c, _ in sorted(track.items())])
    v_raw  = np.array([max(0.0, row_to_v_fn(rr)) for _, rr in sorted(track.items())])
    pk_u, v_sg, a = smooth_curve(pk_raw, v_raw, pk_from, pk_to)

    return {
        'src': str(src),
        'title': title_text,
        'material': material,
        'from': from_code,
        'to': to_code,
        'via': via,
        'pk_from': pk_from,
        'pk_to':   pk_to,
        'v_max':   float(v_sg.max()),
        'a_max':   float(a.max()),
        'a_min':   float(a.min()),
        'n_points': len(pk_u),
        'pk_u': pk_u,
        'v_sg': v_sg,
        'a':    a,
        'col_to_pk_fn': col_to_pk_fn,
        'y_cal': y_cal,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir', help='Directorio con PNGs Siemens')
    ap.add_argument('--out-dir', default=None, help='Carpeta de salida (default = dir)')
    args = ap.parse_args()

    src_dir = Path(args.dir)
    if not src_dir.is_dir():
        print(f'ERROR: no es directorio: {src_dir}', file=sys.stderr); sys.exit(1)
    out_dir = Path(args.out_dir) if args.out_dir else src_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    pngs = sorted([p for p in src_dir.iterdir()
                   if p.suffix.lower() == '.png'
                   and 'RENDER' not in p.stem and 'OVERLAY' not in p.stem
                   and 'DESDE_JSON' not in p.stem and 'DIGITALIZADO' not in p.stem
                   and 'DERIVADAS' not in p.stem])
    print(f'Encontrados {len(pngs)} PNG(s) en {src_dir}')

    manifest = []
    for p in pngs:
        print(f'\n>>> {p.name}')
        result = process_one(p)
        if 'error' in result:
            print(f'  [ERROR] {result["error"]}  | titulo OCR: "{result.get("title","")}"')
            manifest.append({'file': p.name, 'title': result.get('title',''), 'error': result['error']})
            continue
        print(f'  material={result["material"]}  via={result["via"]}  {result["from"]} -> {result["to"]}')
        print(f'  PK [{result["pk_from"]:.3f}, {result["pk_to"]:.3f}]  V max={result["v_max"]:.1f}  a in [{result["a_min"]:.2f}, {result["a_max"]:.2f}]')
        # canonical name
        base = f'{result["material"]}_{result["via"]}_{result["from"]}-{result["to"]}'
        json_out = out_dir / f'{base}.json'
        render_out = out_dir / f'{base}_RENDER.png'
        overlay_out = out_dir / f'{base}_OVERLAY.png'
        # JSON
        data = []
        for i in range(len(result['pk_u'])):
            data.append({
                'pk_km': round(float(result['pk_u'][i]), 4),
                'v_kmh': round(float(result['v_sg'][i]), 3),
                'a_ms2': round(float(result['a'][i]), 4),
            })
        meta = {
            'material': result['material'],
            'via': result['via'],
            'from': result['from'],
            'to': result['to'],
            'from_name': STATION_BY_CODE[result['from']][1],
            'to_name':   STATION_BY_CODE[result['to']][1],
            'pk_from': result['pk_from'],
            'pk_to': result['pk_to'],
            'source_png': p.name,
        }
        with open(json_out, 'w') as f:
            json.dump({'meta': meta, 'curve': data}, f, indent=1, ensure_ascii=False)
        render_clean(result['pk_u'], result['v_sg'], render_out,
                     title=f'{result["material"]} {result["via"]} {result["from"]}→{result["to"]}',
                     pk_from=result['pk_from'], pk_to=result['pk_to'], v_max=result['y_cal'][2],
                     from_code=result['from'], to_code=result['to'])
        y_cal = result['y_cal']
        def v_to_row(v, _rv0=y_cal[1], _rvm=y_cal[0], _vt=y_cal[2]):
            return _rv0 - v/_vt * (_rv0 - _rvm)
        # pk_to_col: invertir col_to_pk_fn por busqueda
        col_pk = result['col_to_pk_fn']
        # Aproximar pk_to_col por regresion en 2 puntos
        c_a = 50; c_b = arr_w = Image.open(p).width - 50
        pk_a = col_pk(c_a); pk_b = col_pk(c_b)
        slope = (c_b - c_a) / (pk_b - pk_a)
        def pk_to_col(pk, _a=c_a, _pa=pk_a, _s=slope): return _a + (pk - _pa) * _s
        render_overlay(p, result['pk_u'], result['v_sg'], pk_to_col, v_to_row, overlay_out)
        manifest.append({
            'file': p.name,
            'title': result['title'],
            'material': result['material'],
            'via': result['via'],
            'from': result['from'],
            'to': result['to'],
            'pk_from': result['pk_from'],
            'pk_to': result['pk_to'],
            'v_max': round(result['v_max'], 2),
            'a_max': round(result['a_max'], 3),
            'a_min': round(result['a_min'], 3),
            'json': json_out.name,
            'render': render_out.name,
            'overlay': overlay_out.name,
        })
        print(f'  OK -> {base}.json + RENDER.png + OVERLAY.png')

    # Manifiesto CSV
    if manifest:
        man_path = out_dir / 'batch_manifest.csv'
        keys = sorted({k for m in manifest for k in m.keys()})
        with open(man_path, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=keys)
            w.writeheader(); w.writerows(manifest)
        print(f'\nManifiesto: {man_path}')

    n_ok = sum(1 for m in manifest if 'error' not in m)
    n_err = len(manifest) - n_ok
    print(f'\nTotal: {n_ok} OK | {n_err} con error')


if __name__ == '__main__':
    main()
