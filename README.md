# STC Operación — Línea 1

<p align="center">
  <strong>Sistema de Análisis Operativo y Simulación de Marcha Tipo para la Línea 1 del Metro de la Ciudad de México</strong>
</p>

---

## 📋 Descripción

**STC Operación L1** es una aplicación web diseñada para el análisis y seguimiento operativo de la **Línea 1 del Sistema de Transporte Colectivo (STC) Metro** de la Ciudad de México. La herramienta permite a los equipos de operación cargar, procesar y visualizar datos de circulación de trenes, comparar contra la marcha tipo Siemens, aplicar restricciones temporales de velocidad (RTV) y generar reportes ejecutivos en PDF.

## 🚀 Funcionalidad

### Análisis de operación diaria
- **Carga y procesamiento** de archivos Excel con registros de circulación (arribos, partidas, estaciones, vías).
- **Diagrama de hilo (Canvas)** — trazado tiempo–estación de cada tren con zoom temporal, cursor de medición y marcadores de eventos (DBO, saltos de estación).
- **Marcha tipo dinámica** — sobre cada vuelta detectada se superpone la marcha tipo Siemens correspondiente a `(material rodante, vía, horario)` deducidos automáticamente del tren y la hora.
- **Análisis de maniobras** — detección y clasificación automática de maniobras operativas (O y V) en terminales, con duraciones.
- **Diagramas Boxplot** — análisis estadístico de tiempos de recorrido entre estaciones.
- **Tabla de alarmas** — identificación de incidencias y anomalías.
- **Reportes PDF** — exportación multipágina con heatmaps, tablas de períodos y estadísticas de material rodante.

### Módulo Marcha Tipo
- **Visualizador de las 4 curvas Siemens** (NM16 V1, NM16 V2, NM22 V1, NM22 V2) continuas PAN↔OBS, con sincronización de scroll/zoom entre paneles y navegación por estaciones.
- **Aplicación de RTV** sobre las curvas:
  - Catálogo de CDV físicos + virtuales (`public/data/cdv_catalog.json`).
  - Modal para seleccionar CDV, fijar velocidad límite y agrupar restricciones.
  - Cálculo de la **zona efectiva** considerando el largo del tren (151.33 m) — zona [pki, pkf] más despeje por cola según la vía.
  - Recorte de la curva con frenado SBI físico previo y aceleración (curva accel(v) del material) posterior.
  - Visualización con bandas (rojo = RTV, amarillo = despeje), línea horizontal punteada del límite y curva afectada superpuesta en rojo.
- **Cálculo de tiempos por horario** (Valle / Pico Mañana / Pico Tarde):
  - Tiempo de marcha (rodando), paradas intermedias y terminales por vuelta.
  - Calibración contra PDF Headway Siemens — error <2%.
  - **Δt por RTV y total por vuelta** para cada material.
- **Reporte PDF de afectación** — portada, metodología, datos de los trenes (NM16/NM22), un gráfico por cada RTV aplicada con la curva afectada, conclusión tabular con Δt por RTV y total por vuelta.

## 🛠️ Stack Tecnológico

| Tecnología | Uso |
|---|---|
| **React 19** + **TypeScript** | Framework UI con tipado estático |
| **Vite** | Bundler y dev server |
| **Firebase Auth / Storage / Hosting** | Autenticación, almacenamiento y despliegue |
| **jsPDF** | Generación de reportes PDF |
| **SheetJS (xlsx)** | Procesamiento de Excel |
| **Canvas API** | Diagramas y gráficos interactivos |
| **Python 3 + PIL + scipy + tesseract** | Pipeline offline de digitalización de curvas Siemens |

## 🧪 Pipeline de digitalización de curvas (offline)

Scripts Python que extraen las 76 curvas v(PK) de los PDF Siemens y las arman como JSONs que carga la app:

- `extract_curve.py` — extrae una curva individual de un PNG (calibración, filtrado de color, tracking, suavizado PCHIP + Savitzky–Golay).
- `batch_extract.py` — procesa un directorio completo, lee títulos con OCR (tesseract) para inferir material y vía, ancla endpoints a los PK oficiales de las estaciones.
- `stitch.py` — concatena las 19 interestaciones por (material, vía) en 4 trayectorias continuas PAN↔OBS.

Datos resultantes en `public/marchas/` (4 JSON de ~600 KB cada uno).

**Fuente primaria**: Siemens Mobility, "Simulación de Headway", referencia **2022-MRRC-CB.ATC-L1MO-000-III-00702096-I Rev D**.

## ☁️ Infraestructura

- **Firebase Hosting** sirve la app estática.
- **Firebase Storage** almacena los datasets Excel diarios.
- **Firebase Authentication** controla el acceso.
- **Firebase Firestore** persiste configuraciones de la aplicación.

## 📁 Estructura del Proyecto

```
stc-operacion/
├── public/
│   ├── data/                      # CDV catalog, trenes, presets de RTV
│   ├── marchas/                   # 4 JSON de curvas stitched (PAN↔OBS por material)
│   ├── days/                      # Indice de días disponibles
│   └── *.png                      # Logos (metro, ingerop)
├── src/
│   ├── components/
│   │   ├── AlarmTable             # Tabla de alarmas
│   │   ├── Boxplot                # Diagramas estadísticos
│   │   ├── Calendar               # Selector de día
│   │   ├── Diagram                # Diagrama de hilo (Canvas)
│   │   ├── FilesModal             # Listado de datasets en Storage
│   │   ├── Insights               # Panel de indicadores
│   │   ├── Login                  # Auth
│   │   ├── ManeuversPanel         # Panel de maniobras
│   │   ├── MarchasViewer          # Visualizador de curvas Siemens + RTV
│   │   ├── Reports                # Generador PDF de operación
│   │   ├── UploadModal            # Carga de Excel
│   │   └── diagram/               # Render Canvas del diagrama de hilo
│   ├── contexts/                  # Estado global (Auth)
│   ├── data/
│   │   ├── marchaTipo.ts          # buildMarchaTipo(direction, material, horario)
│   │   ├── marchaTipoSiemens.ts   # Tablas 9-27 (segmentos) y helpers
│   │   └── stationPK.ts           # PKs oficiales del plano de vía
│   ├── hooks/                     # useExcelProcessor, useMarchaAnalysis, useAnalytics, useInsights
│   ├── services/                  # Firebase Storage / index de días
│   ├── simulador/                 # Catálogo CDV, tiempos parada (Tabla 8), engine simulador
│   ├── types/                     # Tipos TS
│   ├── utils/                     # pdfExport, rtvReport
│   ├── firebase.ts                # Config Firebase
│   ├── App.tsx                    # Punto de entrada
│   └── main.tsx
├── batch_extract.py               # Pipeline offline: extrae las 76 curvas Siemens
├── extract_curve.py               # Extracción de curva individual (1 PNG → JSON)
├── stitch.py                      # Une las 19 interestaciones por (material, vía)
├── firebase.json
├── vite.config.ts
└── package.json
```

## ⚙️ Instalación y Desarrollo Local

```bash
git clone https://github.com/hernanbarreto/stc-operacion.git
cd stc-operacion

npm install

# Configurar credenciales Firebase
cp .env.example .env   # editar con las credenciales

npm run dev
```

### Pipeline Python (sólo para regenerar curvas Siemens desde nuevos PDF)

```bash
pip install pillow numpy scipy pytesseract
sudo apt install tesseract-ocr tesseract-ocr-spa

# 1. Extraer curvas individuales del directorio de PNGs
python3 batch_extract.py "ruta/al/directorio/de/imagenes" --out-dir curvas_procesadas/_tmp

# 2. Concatenar en 4 stitched
python3 stitch.py curvas_procesadas/JSONS

# 3. Copiar al app
cp curvas_procesadas/STITCHED/*.json public/marchas/
```

## 🚢 Despliegue

```bash
npm run build
firebase deploy
```

## 👨‍💻 Equipo

Desarrollado por **Ingerop T3**:

- **Hernán Barreto** — Desarrollo
- **Leonardo Casale** — Colaboración

## 📄 Licencia

Uso interno — Sistema de Transporte Colectivo (STC) Metro de la Ciudad de México.
