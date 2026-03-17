# STC Operación — Línea 1

<p align="center">
  <strong>Sistema de Análisis Operativo para la Línea 1 del Metro de la Ciudad de México</strong>
</p>

---

## 📋 Descripción

**STC Operación L1** es una aplicación web diseñada para el análisis y seguimiento operativo de la **Línea 1 del Sistema de Transporte Colectivo (STC) Metro** de la Ciudad de México. La herramienta permite a los equipos de operación cargar, procesar y visualizar datos de circulación de trenes de forma interactiva, generando reportes ejecutivos de alta calidad.

## 🚀 ¿Para qué se usa?

El sistema se utiliza para:

- **Carga y procesamiento** de archivos Excel con registros de circulación de trenes (arribos, partidas, estaciones, vías).
- **Diagramas de marcha interactivos** — visualización Canvas en tiempo real de los recorridos de trenes sobre el eje tiempo–estación, con soporte de zoom temporal y marcadores de eventos especiales (DBO, saltos de estación).
- **Análisis de maniobras** — detección y clasificación automática de maniobras operativas (O y V) en terminales, con cálculo de duraciones.
- **Diagramas de Boxplot** — análisis estadístico de tiempos de recorrido entre estaciones.
- **Tabla de alarmas** — identificación de incidencias y anomalías operativas.
- **Generación de reportes PDF** — exportación de reportes ejecutivos multipágina con tablas heatmap, estadísticas de material rodante e información de períodos operativos.
- **Almacenamiento compartido en la nube** — gestión centralizada de datasets vía Firebase Storage para acceso colaborativo del equipo.

## 🛠️ Stack Tecnológico

| Tecnología | Uso |
|---|---|
| **React 19** + **TypeScript** | Framework de UI y tipado estático |
| **Vite** | Bundler y servidor de desarrollo |
| **Firebase Auth** | Autenticación de usuarios |
| **Firebase Firestore** | Base de datos en la nube |
| **Firebase Storage** | Almacenamiento de archivos Excel |
| **Firebase Hosting** | Alojamiento y despliegue de la aplicación |
| **jsPDF** | Generación de reportes en formato PDF |
| **SheetJS (xlsx)** | Lectura y procesamiento de archivos Excel |
| **Lucide React** | Iconografía moderna |
| **Canvas API** | Renderizado de diagramas de marcha interactivos |

## ☁️ Infraestructura y Alojamiento

La aplicación se encuentra alojada en **[Firebase](https://firebase.google.com/)**, la plataforma de desarrollo de aplicaciones de Google. Específicamente:

- **Firebase Hosting** — sirve la aplicación web como un sitio estático optimizado con CDN global, garantizando tiempos de carga rápidos desde cualquier ubicación. El proyecto está configurado bajo el ID **`stc-operacion`**.
- **Firebase Storage** — almacena los archivos Excel de datos operativos, permitiendo que múltiples usuarios del equipo compartan y descarguen datasets de forma centralizada.
- **Firebase Authentication** — gestiona el acceso seguro de los usuarios autorizados al sistema.
- **Firebase Firestore** — proporciona una base de datos NoSQL en tiempo real para la persistencia de configuraciones y datos de la aplicación.

> La URL de producción se encuentra disponible a través de Firebase Hosting en el dominio asignado al proyecto `stc-operacion`.

## 📁 Estructura del Proyecto

```
operacion-web-app/
├── public/               # Archivos estáticos (favicon, assets)
├── src/
│   ├── components/       # Componentes React
│   │   ├── AlarmTable    # Tabla de alarmas operativas
│   │   ├── Boxplot       # Diagramas estadísticos
│   │   ├── Diagram       # Diagrama de marcha interactivo (Canvas)
│   │   ├── Insights      # Panel de indicadores
│   │   ├── Login         # Autenticación de usuarios
│   │   ├── ManeuversPanel# Panel de maniobras
│   │   ├── MarchaConfig  # Configuración de marcha tipo
│   │   ├── Reports       # Generación de reportes PDF
│   │   └── Upload        # Carga de archivos Excel
│   ├── contexts/         # Contextos de React (estado global)
│   ├── data/             # Datos estáticos y configuración
│   ├── hooks/            # Custom hooks (procesamiento Excel)
│   ├── services/         # Servicios (Firebase Storage)
│   ├── types/            # Definiciones de tipos TypeScript
│   ├── utils/            # Utilidades y helpers
│   ├── firebase.ts       # Configuración de Firebase
│   ├── App.tsx           # Componente principal
│   └── main.tsx          # Punto de entrada
├── firebase.json         # Configuración de Firebase Hosting
├── .firebaserc           # Proyecto de Firebase vinculado
├── vite.config.ts        # Configuración de Vite
└── package.json          # Dependencias y scripts
```

## ⚙️ Instalación y Desarrollo Local

```bash
# Clonar el repositorio
git clone https://github.com/hernanbarreto/stc-operacion.git
cd stc-operacion

# Instalar dependencias
npm install

# Configurar variables de entorno
# Crear archivo .env con las credenciales de Firebase (ver .env.example)

# Iniciar servidor de desarrollo
npm run dev
```

## � Despliegue

El despliegue se realiza automáticamente hacia Firebase Hosting:

```bash
# Compilar para producción
npm run build

# Desplegar a Firebase
firebase deploy
```

## �‍💻 Desarrollo

Desarrollado por **Ingerop T3**:

- **Hernán Barreto** — Desarrollo principal
- **Leonardo Casale** — Colaboración

## �📄 Licencia

Uso interno — Sistema de Transporte Colectivo (STC) Metro de la Ciudad de México.
