import { foo as bar } from './a';

export function useFoo(): number {
  return bar();
}
