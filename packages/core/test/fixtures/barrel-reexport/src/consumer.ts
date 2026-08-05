import { Greeter } from './index';

export function run(): string {
  const g = new Greeter();
  return g.greet();
}
