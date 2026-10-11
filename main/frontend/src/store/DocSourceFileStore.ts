import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore, SourceResult } from './DocSourceStore.js';
import { sourcePathIsRooted, sourcePathNormalize } from '../lib/doc-source-path.js';

// The file-creation service of the source layer as the page offers it to
// components (design: doc_page_impl_source.md#creating-files). A component
// that holds bytes to keep (an image pasted into Image) reports
// fileCreateRequest through the event layer; the source route brings it
// here:
//
//   fileCreateRequest { name, blob | text, dirPath, isLocationCustom }
//     name              the file name wanted; made unique in the folder
//     dirPath           the folder, a source path; a component takes it
//                       from its component-level config (FileStoreDir)
//     isLocationCustom  true: the person chooses the folder (and may
//                       rename the file) in the location prompt first
//     -> { code: 0, data: { path, entry } } | { code: -1, message }
//
// prompt: the one location prompt that is open (SourceFilePrompt renders
// it). it stays open while the file is created, so a failure is shown in
// it and another folder can be tried; dismissing it answers the request
// with a failure.

type SourcePoint = { clientX: number; clientY: number };

type SourceLocation = { dirPath: string; name: string };

export type SourceFilePrompt = {
  dirPath: string;
  name: string;
  status: 'open' | 'submitting' | 'error';
  message: string;
  // where the pointer was when the request was made (the prompt opens there)
  point?: SourcePoint;
  // settles the pending wait of the request: the chosen location, or
  // undefined when the prompt is dismissed
  resolve: (location: SourceLocation | undefined) => void;
};

type FileCreateRequestData = { name?: string; blob?: Blob; text?: string; dirPath?: string; isLocationCustom?: boolean };

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any>; point?: SourcePoint };

export const sourceEventTypeList = ['fileCreateRequest'];

export class DocSourceFileStore {
  sourceStore: DocSourceStore;
  prompt: SourceFilePrompt | undefined = undefined;

  constructor(sourceStore: DocSourceStore) {
    this.sourceStore = sourceStore;
    makeAutoObservable(this, { sourceStore: false });
  }

  // the handler the source route of the event layer calls
  async eventHandle(event: DocEvent): Promise<SourceResult | undefined> {
    if (event.type !== 'fileCreateRequest') return undefined;
    return this.fileCreateRequestHandle(event.data, event.point);
  }

  async fileCreateRequestHandle(data: FileCreateRequestData, point?: SourcePoint): Promise<SourceResult> {
    if (!this.sourceStore.isWritable) {
      return { code: -1, message: 'The source is read-only: files are created through the development server only.' };
    }
    const name = String(data.name ?? '').trim();
    if (!name) return { code: -1, message: 'fileCreateRequest needs the file name.' };
    if (!(data.blob instanceof Blob) && typeof data.text !== 'string') {
      return { code: -1, message: 'fileCreateRequest needs the content: blob or text.' };
    }
    const dirPath = sourcePathNormalize(String(data.dirPath ?? ''));
    const isPromptNeeded = data.isLocationCustom === true || !sourcePathIsRooted(dirPath);
    if (!isPromptNeeded) return this.fileCreateApply({ dirPath, name }, data);

    // the person chooses the location; a failed creation keeps the prompt
    // open with the message, and a new confirmation tries again
    this.promptOpen(dirPath, name, point);
    while (this.prompt) {
      const location = await this.promptLocationAwait();
      if (!location) return { code: -1, message: 'The file was not created: no folder was chosen.' };
      const result = await this.fileCreateApply(location, data);
      if (result.code === 0) {
        runInAction(() => { this.prompt = undefined; });
        return result;
      }
      runInAction(() => {
        if (!this.prompt) return;
        this.prompt.status = 'error';
        this.prompt.message = result.message;
      });
    }
    return { code: -1, message: 'The file was not created: the prompt was dismissed.' };
  }

  private fileCreateApply(location: SourceLocation, data: FileCreateRequestData): Promise<SourceResult> {
    const nameUnique = this.sourceStore.fileNameUniqueGet(location.dirPath, location.name);
    return this.sourceStore.fileCreate({ dirPath: location.dirPath, name: nameUnique, blob: data.blob, text: data.text });
  }

  // ---------- the location prompt ----------

  private promptOpen(dirPath: string, name: string, point?: SourcePoint): void {
    this.prompt?.resolve(undefined);
    this.prompt = {
      dirPath: dirPath || this.sourceStore.dirListWritable[0]?.internalPath || '',
      name,
      status: 'open',
      message: '',
      point,
      resolve: () => {},
    };
  }

  private promptLocationAwait(): Promise<SourceLocation | undefined> {
    return new Promise((resolve) => {
      runInAction(() => {
        if (!this.prompt) {
          resolve(undefined);
          return;
        }
        this.prompt.resolve = resolve;
      });
    });
  }

  promptDirPathSet(dirPath: string): void {
    if (!this.prompt) return;
    this.prompt.dirPath = sourcePathNormalize(dirPath);
    if (this.prompt.status === 'error') {
      this.prompt.status = 'open';
      this.prompt.message = '';
    }
  }

  promptNameSet(name: string): void {
    if (!this.prompt) return;
    this.prompt.name = name.trim();
  }

  // the folder must be one of the source: a folder the completion knows
  get promptDirPathIsValid(): boolean {
    const dirPath = this.prompt?.dirPath ?? '';
    return sourcePathIsRooted(dirPath) && this.sourceStore.dirListWritable.some((dir) => dir.internalPath === dirPath);
  }

  promptConfirm(): void {
    const prompt = this.prompt;
    if (!prompt || prompt.status === 'submitting') return;
    if (!this.promptDirPathIsValid) {
      prompt.status = 'error';
      prompt.message = `${prompt.dirPath || '(empty)'} is not a folder of the source.`;
      return;
    }
    if (!prompt.name) {
      prompt.status = 'error';
      prompt.message = 'The file needs a name.';
      return;
    }
    prompt.status = 'submitting';
    prompt.message = '';
    prompt.resolve({ dirPath: prompt.dirPath, name: prompt.name });
  }

  promptCancel(): void {
    const prompt = this.prompt;
    if (!prompt) return;
    this.prompt = undefined;
    prompt.resolve(undefined);
  }
}
