import { encode } from '@toon-format/toon';
import { Failure } from './errors.ts';

export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export type Output = Record<string, Scalar | Row | Row[] | string[]>;
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
export function toon(data: Output): string {
  return encode(data);
}
export function serialize(data: Output, json: boolean, cleaner: Cleaner): string {
  const out = cleaner.redact(json ? JSON.stringify(data,null,2) : toon(data)) + '\n';
  if (Buffer.byteLength(out,'utf8') > 1024*1024) throw new Failure('Serialized output exceeds 1 MiB.', 'output_limit');
  return out;
}
