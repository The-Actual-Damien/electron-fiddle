import * as MonacoType from 'monaco-editor';

// Type-only-import
import { App as AppType } from './renderer/app';
import { EditorId } from './interfaces';

declare global {
  interface Window {
    ElectronFiddle: {
      appPaths: Record<string, string>;
      app: AppType;
      contentChangeListeners: Array<any>;
      editors: Record<
        EditorId,
        MonacoType.editor.IStandaloneCodeEditor | null | undefined
      >;
    };
  }
}
