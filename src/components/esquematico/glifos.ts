// Símbolos de vía dibujados como trazos SVG (los usan el lienzo y la leyenda).

/** Símbolo de junta según el tipo de lazo del plano de CDV (tamaño constante en pantalla: h en unidades de lienzo). */
export function glifoJunta(tipo: string | null, x: number, y: number, h: number): string {
  const a = h / 2;
  switch (tipo) {
    case 'LS': return `M${x - a * 0.6} ${y - h}C${x + a * 1.4} ${y - a * 0.9} ${x - a * 1.4} ${y + a * 0.9} ${x + a * 0.6} ${y + h}`;
    case 'LC': return `M${x - a * 0.7} ${y - h}V${y + h}H${x + a * 0.7}V${y - h}Z`;
    case 'LT': return `M${x - a * 0.7} ${y - h}V${y + a}Q${x} ${y + h * 1.2} ${x + a * 0.7} ${y + a}V${y - h}`;
    case 'AC': return `M${x - a} ${y}a${a} ${a} 0 1 0 ${2 * a} 0a${a} ${a} 0 1 0 ${-2 * a} 0M${x} ${y - h}V${y + h}`;
    case 'JAR': return `M${x - a * 0.35} ${y - h}V${y + h}M${x + a * 0.35} ${y - h}V${y + h}`;
    default: return `M${x} ${y - h}V${y + h}`;
  }
}
