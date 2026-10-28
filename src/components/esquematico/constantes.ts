// Configuración visual del esquemático (colores, capas, modos, bandas verticales).

export type Modo = 'ihm' | 'cdv' | 'frecuencia' | 'tipo' | 'enclavamiento' | 'velocidad';

export type Capa =
  | 'trenes' | 'estados' | 'rutas' | 'dbo' | 'fantasmas' | 'energia_zonas' | 'senales' | 'agujas' | 'juntas_fisicas' | 'juntas_virtuales' | 'lazos' | 'cdv_nombres'
  | 'secciones_nombres' | 'andenes' | 'avc' | 'topes' | 'limites' | 'pk' | 'balizas' | 'psp' | 'fp'
  | 'marcadores_al' | 'vel_zonas' | 'vel_agujas' | 'pendientes' | 'equipos' | 'reset' | 'zonas_rauz'
  | 'zonas_asr' | 'armarios' | 'subestaciones' | 'carteles' | 'tramos' | 'rotulos';

export const GRUPOS_CAPAS: { grupo: string; capas: { key: Capa; label: string }[] }[] = [
  {
    grupo: 'Vía y señalización', capas: [
      { key: 'senales', label: 'Señales' },
      { key: 'agujas', label: 'Agujas' },
      { key: 'juntas_fisicas', label: 'Juntas de CDV' },
      { key: 'juntas_virtuales', label: 'Límites de sección' },
      { key: 'lazos', label: 'Tipo de lazo / junta' },
      { key: 'cdv_nombres', label: 'Nombres de CDV' },
      { key: 'secciones_nombres', label: 'Nombres de sección' },
      { key: 'topes', label: 'Topes' },
      { key: 'fp', label: 'Puntos de libramiento (FP)' },
      { key: 'marcadores_al', label: 'Marcadores AL' },
      { key: 'carteles', label: 'Cartelones aviso / ejecución' },
    ],
  },
  {
    grupo: 'CBTC / ATC', capas: [
      { key: 'balizas', label: 'Balizas' },
      { key: 'psp', label: 'PSP' },
      { key: 'avc', label: 'AVC (TGMT)' },
      { key: 'equipos', label: 'Salas MX, OC, ZC, WCU, PML' },
      { key: 'reset', label: 'RESET (plano de CDV)' },
      { key: 'zonas_rauz', label: 'Zonas RAUZ (hoja 24)' },
      { key: 'zonas_asr', label: 'Zonas ASR (hoja 25)' },
    ],
  },
  {
    grupo: 'Perfil de vía', capas: [
      { key: 'vel_zonas', label: 'Velocidades (estación y curvas)' },
      { key: 'vel_agujas', label: 'Velocidad en agujas' },
      { key: 'pendientes', label: 'Pendientes' },
    ],
  },
  {
    grupo: 'Infraestructura', capas: [
      { key: 'andenes', label: 'Andenes / BFU' },
      { key: 'limites', label: 'Límites de estación / WCU' },
      { key: 'armarios', label: 'Ubicaciones de equipos de CDV' },
      { key: 'tramos', label: 'Tramos subterráneo / techado / superficie' },
      { key: 'rotulos', label: 'Rótulos del plano' },
      { key: 'pk', label: 'Escala de PK' },
    ],
  },
  {
    grupo: 'Energía', capas: [
      { key: 'subestaciones', label: 'Subestaciones (S/E) y alimentación' },
      { key: 'energia_zonas', label: 'Tramos entre subestaciones' },
    ],
  },
  {
    grupo: 'Reproducción de eventos', capas: [
      { key: 'trenes', label: 'Trenes (número y posición)' },
      { key: 'rutas', label: 'Itinerarios y deslizamientos' },
      { key: 'dbo', label: 'DBO' },
      { key: 'estados', label: 'Alarmas y marcas sobre los elementos' },
      { key: 'fantasmas', label: 'Tren de marcha tipo' },
    ],
  },
];

export const CAPAS_INICIALES: Capa[] = ['senales', 'agujas', 'juntas_fisicas', 'juntas_virtuales', 'lazos',
  'cdv_nombres', 'secciones_nombres', 'andenes', 'avc', 'topes', 'limites', 'pk', 'balizas', 'vel_zonas',
  'vel_agujas', 'equipos', 'armarios', 'subestaciones', 'energia_zonas', 'carteles', 'tramos', 'rotulos', 'fp',
  'trenes', 'rutas', 'dbo', 'estados', 'fantasmas'];

export const MODOS: { key: Modo; label: string }[] = [
  { key: 'ihm', label: 'IHM' },
  { key: 'cdv', label: 'CDV físico' },
  { key: 'frecuencia', label: 'Frecuencia' },
  { key: 'tipo', label: 'Tipo CDV' },
  { key: 'enclavamiento', label: 'Enclavamiento' },
  { key: 'velocidad', label: 'Velocidad' },
];

export const FREQ_COLORS: Record<string, string> = {
  F5: '#60a5fa', F6: '#34d399', F7: '#fbbf24', F8: '#f472b6', F9: '#a78bfa', F10: '#22d3ee', F11: '#fb923c', F12: '#a3e635',
};
export const TIPO_COLORS: Record<string, string> = { ST: '#94a3b8', MI: '#38bdf8', PO: '#f59e0b' };
export const IXL_COLORS: Record<string, string> = { PANIXL: '#60a5fa', OBSIXL: '#f59e0b' };
export const CDV_ALT = ['#cbd5e1', '#38bdf8', '#a78bfa'];
export const VIA_IHM = '#8b97a8';
export const SIN_DATO = '#475569';
export const LAMP: Record<string, string> = { R: '#ef4444', V: '#22c55e', A: '#facc15' };
export const LAZO_COLORS: Record<string, string> = {
  LS: '#22c55e', LC: '#38bdf8', LT: '#f59e0b', AC: '#e879f9', JAR: '#f87171', J: '#94a3b8',
};

/** Color por velocidad máxima (km/h). */
export function colorVelocidad(v: number | null | undefined): string {
  if (v == null) return SIN_DATO;
  if (v <= 30) return '#ef4444';
  if (v <= 45) return '#f97316';
  if (v <= 60) return '#facc15';
  if (v <= 70) return '#a3e635';
  if (v <= 75) return '#4ade80';
  return '#38bdf8';
}

export const Y_PK = 74;
export const Y_EST = 146;
export const Y_ARM = 380;     // banda de ubicaciones de equipos de CDV (debajo de la tira)
export const Y_TOP = 132;     // banda superior para cartelones y tramos
export const Y_SE = 318;      // símbolo de la subestación (debajo de la tira)
export const Y_ENER = 346;    // banda de tramos entre subestaciones

// Vista general: la línea completa partida en filas (como la vista general de una IHM de ATS)
export const G_Y0 = 86;
export const G_Y1 = 412;
export const Y_PK_G = 95;    // escala de PK en la vista general
export const G_ROW = G_Y1 - G_Y0;
export const G_GAP = 10;
export const G_SOLAPE = 14;
export const DET_H = 350;     // alto visible en la vista de detalle al entrar desde la general

export const COLOR_MATERIAL: Record<string, string> = { NM16: '#38bdf8', NM22: '#a78bfa' };
export const COLOR_CATEGORIA: Record<string, string> = {
  movimiento: '#22c55e', alarma: '#f97316', comando: '#38bdf8', tren: '#22d3ee', ihm: '#a78bfa',
  enclavamiento: '#ef4444', otro: '#94a3b8',
};

/** Color de resaltado por tipo de intervalo activo en la reproducción. */
export const COLOR_ESTADO: Record<string, string> = {
  detenido: '#f97316', arb: '#e879f9', nrb: '#c084fc', alarma: '#facc15', rebase: '#ef4444', dbo: '#dc2626', degradado: '#ef4444',
  tarjeta: '#ef4444', ihm: '#a78bfa', ixl: '#ef4444', marca: '#22d3ee',
};
export const COLOR_RUTA = '#22c55e';
export const COLOR_DESL = '#f59e0b';
