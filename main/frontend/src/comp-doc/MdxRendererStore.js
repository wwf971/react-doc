import { makeAutoObservable, observable, runInAction } from 'mobx';
import { compileDoc } from '../lib/mdx-compile.js';

// compile state of one MdxRenderer instance.
// Body is a component function, so it is observed only by reference.
export class MdxRendererStore {
  status = 'empty';
  Body = null;
  message = '';
  compileVersion = 0;

  constructor() {
    makeAutoObservable(this, { Body: observable.ref });
  }

  async compile({ source, format, remarkPlugins }) {
    this.compileVersion += 1;
    const compileVersion = this.compileVersion;
    if (!source.trim()) {
      this.statusSet('empty', null, '');
      return;
    }
    this.statusSet('loading', null, '');
    try {
      const compiled = await compileDoc({
        source,
        internalPath: '',
        format,
        config: {
          isCommentComponentEnabled: false,
          isDefaultLinkRecognitionEnabled: false,
          remarkPlugins: remarkPlugins ?? [],
        },
      });
      if (compileVersion !== this.compileVersion) return;
      runInAction(() => this.statusSet('done', compiled.Body, ''));
    } catch (error) {
      if (compileVersion !== this.compileVersion) return;
      runInAction(() => this.statusSet('error', null, String(error?.message ?? error)));
    }
  }

  statusSet(status, Body, message) {
    this.status = status;
    this.Body = Body;
    this.message = message;
  }
}
