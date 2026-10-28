// Cliente del worker de eventos: abre un Excel del ATS (de Storage o local) y entrega las filas de un día.
import type { FilaLog } from './eventos';

type Resp = { id: number; ok: boolean; error?: string; dias?: { fecha: string; n: number }[]; filas?: FilaLog[]; n?: number; tipos?: number; csv?: string };

export class LectorEventos {
  private w: Worker | null = null;
  private seq = 0;
  private pend = new Map<number, (r: Resp) => void>();

  private worker(): Worker {
    if (!this.w) {
      this.w = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
      this.w.onmessage = (e: MessageEvent<Resp>) => {
        const f = this.pend.get(e.data.id);
        if (f) { this.pend.delete(e.data.id); f(e.data); }
      };
    }
    return this.w;
  }

  private llamar(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Resp> {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pend.set(id, r => (r.ok ? res(r) : rej(new Error(r.error ?? 'error en el worker'))));
      this.worker().postMessage({ ...msg, id }, transfer);
    });
  }

  /** Abre un archivo (se guarda en el worker) y devuelve los días que contiene. */
  async abrir(nombre: string, buffer: ArrayBuffer): Promise<{ fecha: string; n: number }[]> {
    return (await this.llamar({ op: 'abrir', nombre, buffer }, [buffer])).dias ?? [];
  }

  async dia(nombre: string, fecha: string): Promise<FilaLog[]> {
    return (await this.llamar({ op: 'dia', nombre, fecha })).filas ?? [];
  }

  /** Suma un archivo a la clasificación de eventos (reiniciar = empezar una nueva). */
  async clasificar(nombre: string, buffer: ArrayBuffer, reiniciar: boolean): Promise<{ n: number; tipos: number }> {
    const r = await this.llamar({ op: 'clasificar', nombre, buffer, reiniciar }, [buffer]);
    return { n: r.n ?? 0, tipos: r.tipos ?? 0 };
  }

  async csvClasificacion(): Promise<string> {
    return (await this.llamar({ op: 'csv' })).csv ?? '';
  }
}
