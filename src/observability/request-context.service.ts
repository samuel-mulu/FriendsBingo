import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextState {
  requestId: string;
  method: string;
  path: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextState>();

  run<T>(state: RequestContextState, fn: () => T): T {
    return this.storage.run(state, fn);
  }

  get(): RequestContextState | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.get()?.requestId;
  }

  getRequestIdForLog(): string {
    return this.getRequestId() ?? 'none';
  }
}
