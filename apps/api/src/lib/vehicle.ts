/**
 * Normalise an Indian vehicle registration number: "ka-01 ab 1234" → "KA01AB1234".
 * Also accepts BH-series ("22 BH 1234 AA").
 */
export function normalizeVehicleNumber(input: string): string | null {
  const v = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const standard = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;
  const bharat = /^\d{2}BH\d{4}[A-Z]{1,2}$/;
  if (v.length < 6 || v.length > 11) return null;
  return standard.test(v) || bharat.test(v) ? v : null;
}
