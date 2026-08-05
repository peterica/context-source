import { Shape, BaseShape } from './base';

export class Square extends BaseShape implements Shape {
  area(): number {
    return 1;
  }
}
