import { onClick, registerHandler } from './handlers';

export function setup(): void {
  registerHandler(onClick);
}
