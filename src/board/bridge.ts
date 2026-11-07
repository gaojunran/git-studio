import type { BoardHostMessage, BoardWebviewMessage } from '../shared/board';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function post(message: BoardWebviewMessage): void {
  api.postMessage(message);
}

export function onMessage(handler: (message: BoardHostMessage) => void): () => void {
  const listener = (event: MessageEvent<BoardHostMessage>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
