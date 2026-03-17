// Tipo para un evento del ATS
export interface ATSEvent {
  datetime: Date;
  evento: 'ARRIBO' | 'PARTIO' | 'SALTO' | 'DBO_ACTIVAR' | 'DBO_DESACTIVAR';
  tren: string;
  estacion: string;
  via: string;
  periodo: 'N' | 'PM' | 'PV' | 'V' | 'DESC';
}

// Tipo para datos procesados del diagrama
export interface DiagramData {
  eventos: ATSEvent[];
  fecha: string;
  dia_semana: string;
  trenes: string[];
  estaciones: string[];
}

// Tipo para cursor en el diagrama
export interface Cursor {
  id: string;
  time: Date;
  estacion: string;
  color: string;
}

// Tipo para cálculo entre cursores
export interface CursorCalculation {
  cursorA: Cursor;
  cursorB: Cursor;
  tiempoMinutos: number;
  distanciaEstaciones: number;
  velocidadEstacionesMinuto: number;
}

// Tipo para datos de Excel cargados
export interface AlarmEvent {
  datetime: Date;
  eventType: string;
  descripcion: string;
  estado: string;
  estacion: string;
}

export interface ExcelUploadData {
  días: string[];
  eventos_por_dia: {
    [fecha: string]: ATSEvent[];
  };
  alarmas_por_dia: {
    [fecha: string]: AlarmEvent[];
  };
}
