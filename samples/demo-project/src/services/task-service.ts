import type { Task, TaskRepository } from '../domain/task';

let nextId = 1;

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  listTasks(): Task[] {
    return this.repository.findAll();
  }

  addTask(title: string): Task {
    const task: Task = { id: String(nextId++), title, done: false };
    this.repository.save(task);
    return task;
  }

  completeAll(): void {
    for (const task of this.listTasks()) {
      task.done = true;
    }
  }
}
