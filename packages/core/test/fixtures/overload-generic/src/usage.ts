import { identity, Box } from './math';

export function run(): void {
  identity(1);
  identity('a');
  const b = new Box<number>();
  b.get(0);
}
