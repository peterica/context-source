import { InMemoryTaskRepository } from './infra/in-memory-task-repository';
import { TaskService } from './services/task-service';

export function bootstrap(): TaskService {
  const repository = new InMemoryTaskRepository();
  const service = new TaskService(repository);
  service.addTask('Write ContextSource docs');
  service.completeAll();
  return service;
}

bootstrap();
