import { Injectable } from '@nestjs/common';
import { MinutiaeTemplate } from './fingerprint-minutiae';

export interface CachedPerson {
  id: number;
  name: string;
  role: string;
  fingerprintTemplate: string;
  /** One template per enrolled scan (one or two placements). */
  parsedMinutiae: MinutiaeTemplate[];
}

@Injectable()
export class FingerprintCache {
  private data: CachedPerson[] | null = null;

  has(): boolean { return this.data !== null; }
  get(): CachedPerson[] | null { return this.data; }
  set(people: CachedPerson[]) { this.data = people; }
  invalidate() { this.data = null; }
}
