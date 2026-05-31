import { Injectable } from '@nestjs/common';

export interface CachedPerson {
  id: number;
  name: string;
  role: string;
  fingerprintTemplate: string;
}

@Injectable()
export class FingerprintCache {
  private data: CachedPerson[] | null = null;

  has(): boolean {
    return this.data !== null;
  }

  get(): CachedPerson[] | null {
    return this.data;
  }

  set(people: CachedPerson[]) {
    this.data = people;
  }

  invalidate() {
    this.data = null;
  }
}
