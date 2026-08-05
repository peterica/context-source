import type { Task, TaskRepository } from '../domain/task';

export class InMemoryTaskRepository implements TaskRepository {
  private tasks: Task[] = [];

  findAll(): Task[] {
    return this.tasks;
  }

  save(task: Task): void {
    this.tasks.push(task);
  }
}
