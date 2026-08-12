import { ConsoleLogger } from './console-logger';
import { OrderService } from './order-service';

export function run(): void {
  const service = new OrderService(new ConsoleLogger());
  service.placeOrder();
}
