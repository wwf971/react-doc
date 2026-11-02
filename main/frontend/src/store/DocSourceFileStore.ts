import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { DocSourceStore, SourceResult } from './DocSourceStore.js';
import { sourcePathIsRooted, sourcePathNormalize } from '../lib/doc-source-path.js';

type SourcePathSpec = { kind: 'dir' | 'file' | 'any'; rootList?: string[]; [key: string]: unknown };

// The file-creation service of the doc page source service layer as the page offers it to
// components (design: doc_page_impl_source.md#creating-files). A component
// that holds bytes to keep (an image pasted into Image) reports
// fileCreateRequest through the event layer; the source route brings it
// here:
//
//   fileCreateRequest { name, blob | text, dirPath, isLocationCustom, anchorElement? }
//     name              the file name wanted; made unique in the folder
//     dirPath           the folder, a source path; a component takes it
//                       from its component-level config (FileStoreDir). a
//                       local path (~root/dir) is a root of the doc page of
//                       the document the request comes from (source.sourcePath)
//     isLocationCustom  true: the person chooses the folder (and may
//                       rename the file) in the location prompt first
//     anchorElement     optional: the element of the component the file is
//                       for (the figure of an Image). the location prompt is
//                       placed in it, so it scrolls with the component instead
//                       of staying where the pointer was. browser state only:
//                       never part of the write request
//     -> { code: 0, data: { path, entry } } | { code: -1, message }
//
// prompt: the one location prompt that is open (SourceFilePrompt renders
// it). it stays open while the file is created, so a failure is shown in
// it and another folder can be tried; dismissing it answers the request
// with a failure. the prompt belongs to the editor of the component that
// asked for the file: using it (and the folder suggestions it opens) is not
// a click outside that editor (SourceFilePrompt carries the edit-popup
// marker, use-edit-outside-pointer.js), so the draft the file is for stays
// active until the path reaches it.
//
// the prompt is the location chooser of the layer, not only of
// fileCreateRequest: locationChoose(option, apply) opens it with the
// folders a caller allows (spec, e.g. the roots of one doc page), its own
// title and action, and runs apply(location) for the confirmed location,
// keeping the prompt open with the failure until apply succeeds or the
// prompt is dismissed. a new document of the side panel is created this way
// (DocSidePanelStore, doc_page_impl_side_panel.md#changing-the-structure).

type SourcePoint = { clientX: number; clientY: number };

type SourceLocation = { dirPath: string; name: string };

// what a caller of locationChoose says about its prompt
export type SourceLocationOption = {
  dirPath: string;
  name: string;
  point?: SourcePoint;
  anchorElement?: HTMLElement;
  // the folders offered; { kind: 'dir' } (every folder of the source) by default
  spec?: SourcePathSpec;
  title?: string;
  actionText?: string;
  pendingText?: string;
  // '' when the name can be used, else why not (checked on confirm)
  nameCheck?: (name: string) => string;
};

export type SourceFilePrompt = {
  dirPath: string;
  name: string;
  spec: SourcePathSpec;
  title: string;
  actionText: string;
  pendingText: string;
  nameCheck?: (name: string) => string;
  status: 'open' | 'submitting' | 'error';
  message: string;
  // where the pointer was when the request was made (the prompt opens there
  // when it has no anchor)
  point?: SourcePoint;
  // the element the prompt is placed in, when the request gave one
  anchorElement?: HTMLElement;
  // settles the pending wait of the request: the chosen location, or
  // undefined when the prompt is dismissed
  resolve: (location: SourceLocation | undefined) => void;
};

type FileCreateRequestData = { name?: string; blob?: Blob; text?: string; dirPath?: string; isLocationCustom?: boolean; anchorElement?: HTMLElement };

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any>; point?: SourcePoint };

export const sourceEventTypeList = ['fileCreateRequest'];

export class DocSourceFileStore {
  sourceStore: DocSourceStore;
  prompt: SourceFilePrompt | undefined = undefined;

  constructor(sourceStore: DocSourceStore) {
    this.sourceStore = sourceStore;
    // the prompt's fields are observable, what they hold is not: the anchor
    // element stays the element the request gave
    makeAutoObservable(this, { sourceStore: false, prompt: observable.shallow });
  }

  // the handler the source route of the event layer calls
  async eventHandle(event: DocEvent): Promise<SourceResult | undefined> {
    if (event.type !== 'fileCreateRequest') return undefined;
    return this.fileCreateRequestHandle(event.data, event.point, String(event.source?.sourcePath ?? ''));
  }

  async fileCreateRequestHandle(data: FileCreateRequestData, point?: SourcePoint, fromPath = ''): Promise<SourceResult> {
    if (!this.sourceStore.isWritable) {
      return { code: -1, message: 'The source is read-only: files are created through the development server only.' };
    }
    const name = String(data.name ?? '').trim();
    if (!name) return { code: -1, message: 'fileCreateRequest needs the file name.' };
    if (!(data.blob instanceof Blob) && typeof data.text !== 'string') {
      return { code: -1, message: 'fileCreateRequest needs the content: blob or text.' };
    }
    const dirPath = this.sourceStore.pathFullGet(String(data.dirPath ?? ''), fromPath);
    const isPromptNeeded = data.isLocationCustom === true || !sourcePathIsRooted(dirPath);
    if (!isPromptNeeded) return this.fileCreateApply({ dirPath, name }, data);
    return this.locationChoose(
      { dirPath, name, point, anchorElement: data.anchorElement },
      (location) => this.fileCreateApply(location, data),
    );
  }

  // the person chooses a location in the prompt, then apply(location) runs;
  // a failure keeps the prompt open with its message, and a new
  // confirmation tries again. answers what apply answered, or a failure
  // when the prompt is dismissed
  async locationChoose(option: SourceLocationOption, apply: (location: SourceLocation) => Promise<SourceResult>): Promise<SourceResult> {
    this.promptOpen(option);
    while (this.prompt) {
      const location = await this.promptLocationAwait();
      if (!location) return { code: -1, message: 'Nothing was created: no folder was chosen.' };
      const result = await apply(location);
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
    return { code: -1, message: 'Nothing was created: the prompt was dismissed.' };
  }

  // only the fields of the write request: nothing else of the event data
  // (the anchor element) reaches the file service
  private fileCreateApply(location: SourceLocation, data: FileCreateRequestData): Promise<SourceResult> {
    const nameUnique = this.sourceStore.fileNameUniqueGet(location.dirPath, location.name);
    return this.sourceStore.fileCreate({ dirPath: location.dirPath, name: nameUnique, blob: data.blob, text: data.text });
  }

  // ---------- the location prompt ----------

  private promptOpen(option: SourceLocationOption): void {
    this.prompt?.resolve(undefined);
    const spec = option.spec ?? { kind: 'dir' };
    this.prompt = {
      dirPath: option.dirPath || this.promptDirListGet(spec)[0] || '',
      name: option.name,
      spec,
      title: option.title ?? 'Save file to',
      actionText: option.actionText ?? 'Create',
      pendingText: option.pendingText ?? 'Creating the file…',
      nameCheck: option.nameCheck,
      status: 'open',
      message: '',
      point: option.point,
      anchorElement: option.anchorElement,
      resolve: () => {},
    };
  }

  // the folders the prompt accepts: folders of the source a file can be
  // written to, narrowed by the prompt's specification
  private promptDirListGet(spec: SourcePathSpec): string[] {
    const dirPathList = this.sourceStore.dirListWritable.map((dir) => dir.internalPath);
    const isNarrowed = Object.keys(spec).some((key) => key !== 'kind');
    if (!isNarrowed) return dirPathList;
    const pathAllowedSet = new Set(this.sourceStore.pathComplete('', spec).map((candidate: any) => candidate.path));
    return dirPathList.filter((dirPath) => pathAllowedSet.has(dirPath));
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

  // the folder must be one of the source the prompt offers
  get promptDirPathIsValid(): boolean {
    const prompt = this.prompt;
    const dirPath = prompt?.dirPath ?? '';
    return Boolean(prompt) && sourcePathIsRooted(dirPath) && this.promptDirListGet(prompt!.spec).includes(dirPath);
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
    const nameMessage = prompt.nameCheck?.(prompt.name) ?? '';
    if (nameMessage) {
      prompt.status = 'error';
      prompt.message = nameMessage;
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
