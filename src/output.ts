import { Failure } from './errors.ts';

export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export type Output = Record<string, Scalar | Row | Row[]>;
export type Truncation = {path: string; original_code_points: number; emitted_code_points: number};
export class Cleaner {
  token: string;
  truncation: Truncation[] = [];
  constructor(token: string) { this.token = token; }
  redact(value: string): string { return this.token ? value.split(this.token).join('[REDACTED]') : value; }
  clean(value: string): string {
    return this.redact(this.redact(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,''));
  }
  field(value: string, path: string, cap: number): string {
    const points = [...this.clean(value)];
    if (points.length > cap) this.truncation.push({path,original_code_points:points.length,emitted_code_points:cap});
    return points.slice(0,cap).join('');
  }
}
function cell(value: Scalar): string {
  if (value === null) return '-';
  if (typeof value !== 'string') return String(value);
  if (!value || value !== value.trim() || /[,:[\]{}"\\\x00-\x1f]/.test(value) ||
    value.startsWith('-') || /^(?:true|false|null)$/.test(value) ||
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || /^-?0\d/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}
export function toon(data: Output): string {
  const lines: string[] = [];
  for (const [key,value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const columns = Object.keys(value[0] ?? {});
      lines.push(columns.length ? key+'['+value.length+']{'+columns.join(',')+'}:' : key+'[0]:');
      for (const row of value) lines.push('  '+columns.map(column => cell(row[column] ?? null)).join(','));
    } else if (value !== null && typeof value === 'object') {
      lines.push(key+':');
      for (const [field, scalar] of Object.entries(value)) lines.push('  '+field+': '+cell(scalar));
    } else lines.push(key+': '+cell(value));
  }
  return lines.join('\n');
}
export function serialize(data: Output, json: boolean, cleaner: Cleaner): string {
  const out = cleaner.redact(json ? JSON.stringify(data,null,2) : toon(data)) + '\n';
  if (Buffer.byteLength(out,'utf8') > 1024*1024) throw new Failure('Serialized output exceeds 1 MiB.', 'output_limit');
  return out;
}
