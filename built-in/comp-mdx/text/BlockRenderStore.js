import { makeAutoObservable, observable, runInAction } from 'mobx';
import { blockCompileStart } from '../../../main/frontend/src/lib/block-compile-cache.js';

// compile state of one BlockRender instance. the previous Body stays visible
// while a newer text compiles, so a live preview does not flicker. the
// compiles are shared (lib/block-compile-cache.js): a text compiled already
// (a block just saved, compiled as its write started) is drawn at once.
//   compiledDone   the compile of the first text, when it is done already
export class BlockRenderStore {
  status = 'empty';
  Body = null;
  message = '';
  compileVersion = 0;

  constructor(compiledDone) {
    if (compiledDone?.Body) {
      this.status = 'done';
      this.Body = compiledDone.Body;
    }
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
      const compiled = await blockCompileStart({ text, internalPath, format, compileConfig });
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
