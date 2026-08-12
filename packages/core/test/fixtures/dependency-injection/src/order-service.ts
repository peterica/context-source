import { Logger } from './logger';

export class OrderService {
  constructor(private readonly logger: Logger) {}

  placeOrder(): void {
    this.logger.log('order placed');
  }
}
