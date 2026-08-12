export class InvalidAuthTokenError extends Error {
  constructor() {
    super('Invalid authentication token');
    this.name = 'InvalidAuthTokenError';
  }
}

export class InvalidPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPasswordError';
  }
}

export class PasswordWorkQueueFullError extends Error {
  constructor() {
    super('Password work queue is full');
    this.name = 'PasswordWorkQueueFullError';
  }
}
