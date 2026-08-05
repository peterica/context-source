export interface Task {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskRepository {
  findAll(): Task[];
  save(task: Task): void;
}
