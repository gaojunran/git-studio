import type * as vscode from 'vscode';
import type { LogOutputChannel } from 'vscode';
import { GuestService } from './guest/service';
import { GuestStore } from './guest/store';

export interface BoardContext {
  guests: GuestStore;
  guestService: GuestService;
  storage: vscode.Uri;
}

export function createBoardContext(
  context: vscode.ExtensionContext,
  output: LogOutputChannel
): BoardContext {
  return {
    guests: new GuestStore(context.globalState),
    guestService: new GuestService(output, context.globalStorageUri, context.secrets),
    storage: context.globalStorageUri
  };
}
