import { Injectable } from '@nestjs/common';

export interface CachedPerson {
  id: number;
  name: string;
  role: string;
  faceDescriptor: number[];
}

@Injectable()
export class DescriptorCache {
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
