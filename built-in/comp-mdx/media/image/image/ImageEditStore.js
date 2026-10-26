import { makeAutoObservable, toJS } from 'mobx';
import { yamlStringify } from '../../../../../main/frontend/src/lib/yaml.js';
import { imageDataParse } from './ImageData.js';

// the draft of an Image block being edited: the yaml mapping of the block as
// plain fields. ImageEdit renders the image from the draft and serializes it
// back to yaml after every change. fields the editor does not know are kept.
// the fields of the floating panel; the caption is edited in the figcaption
export const imageEditFieldList = ['src', 'alt', 'width', 'height'];
export const imageDisplayModeList = ['contain', 'contain-auto', 'fill'];

export class ImageEditStore {
  draft = {};
  message = '';

  constructor(data = {}) {
    makeAutoObservable(this);
    try {
      const { raw: _raw, lang: _lang, content: _content, ...dataParsed } = imageDataParse(data);
      this.draft = dataParsed;
    } catch (error) {
      this.draft = {};
      this.message = String(error?.message ?? error);
    }
  }

  fieldSet(name, value) {
    const valueText = String(value ?? '').trim();
    if (valueText === '') {
      delete this.draft[name];
      return;
    }
    const isSizeField = name === 'width' || name === 'height';
    this.draft[name] = isSizeField && /^\d+(?:\.\d+)?$/.test(valueText) ? Number(valueText) : valueText;
  }

  displayModeSet(displayMode) {
    if (displayMode === 'contain') delete this.draft.displayMode;
    else this.draft.displayMode = displayMode;
  }

  get displayMode() {
    return imageDisplayModeList.includes(this.draft.displayMode) ? this.draft.displayMode : 'contain';
  }

  get rawYaml() {
    return yamlStringify(toJS(this.draft));
  }
}
