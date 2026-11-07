import type { WebviewMessage } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function post(message: WebviewMessage): void {
  api.postMessage(message);
}

export function getState<T>(): T | undefined {
  return api.getState() as T | undefined;
}

export function setState(state: unknown): void {
  api.setState(state);
}
