export interface Shape {
  area(): number;
}

export interface Colored extends Shape {
  color: string;
}

export class BaseShape {
  name = 'base';
}
