export function identity(x: number): number;
export function identity(x: string): string;
export function identity(x: any): any {
  return x;
}

export class Box<T> {
  value!: T;

  get<U = T>(fallback: U): T | U {
    return this.value ?? fallback;
  }
}
