import type { SidebarHostMessage, SidebarMessage } from '../shared/sidebar';

declare function acquireVsCodeApi(): {
  postMessage(message: SidebarMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

export function post(message: SidebarMessage): void {
  vscode.postMessage(message);
}

export function onMessage(handler: (message: SidebarHostMessage) => void): void {
  window.addEventListener('message', (event: MessageEvent<SidebarHostMessage>) => handler(event.data));
}

export function getState<T>(): T | undefined {
  return vscode.getState() as T | undefined;
}

export function setState(state: unknown): void {
  vscode.setState(state);
}
