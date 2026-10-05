import { makeAutoObservable, observable, runInAction } from 'mobx';
import { compileDoc } from '../../frontend/src/lib/mdx-compile.js';

// compile state of one BlockRender instance. the previous Body stays visible
// while a newer text compiles, so a live preview does not flicker.
export class BlockRenderStore {
  status = 'empty';
  Body = null;
  message = '';
  compileVersion = 0;

  constructor() {
    makeAutoObservable(this, { Body: observable.ref });
  }

  async compile({ text, format, internalPath, compileConfig }) {
    this.compileVersion += 1;
    const compileVersion = this.compileVersion;
    if (!text.trim()) {
      this.resultSet('empty', null, '');
      return;
    }
    this.status = 'loading';
    try {
      const compiled = await compileDoc({ source: text, internalPath, format, config: compileConfig ?? {} });
      if (compileVersion !== this.compileVersion) return;
      runInAction(() => this.resultSet('done', compiled.Body, ''));
    } catch (error) {
      if (compileVersion !== this.compileVersion) return;
      runInAction(() => this.resultSet('error', this.Body, String(error?.message ?? error)));
    }
  }

  resultSet(status, Body, message) {
    this.status = status;
    this.Body = Body;
    this.message = message;
  }
}
