// Clave de datos del esquemático guardada en Firestore (documento config/esquematico, campo "clave").
// Las reglas de Firestore deben permitir leerla sólo a usuarios autenticados. Si no existe o no hay
// permiso, la web pide la clave al usuario.
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export async function claveRemota(timeoutMs = 4000): Promise<string | null> {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'config', 'esquematico')),
      new Promise<null>(r => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (!snap || !snap.exists()) return null;
    const v = snap.data()?.clave;
    return typeof v === 'string' && v.length >= 16 ? v : null;
  } catch {
    return null;
  }
}
