// The title of the tab of the browser (design: doc_page_impl.md#the-tab-title): the site
// (the short title of the doc page or workspace, else its title) and the document shown,
// in the order the environment says (doc-env.js tabTitleOrder). The start of a tab is what
// a crowded tab bar shows, so the development server, where several doc pages are open
// side by side while they are tested, names the site first; a build names the document
// first, as sites do.
//
//   docTabTitleGet({ siteTitle, documentTitle, order }) -> the text of document.title
//     siteTitle      configDoc.siteTitleShort ?? configDoc.siteTitle
//     documentTitle  the label of the side-panel item shown, else the title of the document
//     order          'siteFirst' | 'documentFirst'
//   a document named as the site is named once; nothing at all gives TAB_TITLE_DEFAULT

export const TAB_TITLE_SEPARATOR = ' · ';
export const TAB_TITLE_DEFAULT = 'react-doc';

export function docTabTitleGet({ siteTitle = '', documentTitle = '', order = 'documentFirst' } = {}) {
  const site = String(siteTitle ?? '').trim();
  const document = String(documentTitle ?? '').trim();
  if (document === '' || document === site) return site || TAB_TITLE_DEFAULT;
  if (site === '') return document;
  return order === 'siteFirst'
    ? `${site}${TAB_TITLE_SEPARATOR}${document}`
    : `${document}${TAB_TITLE_SEPARATOR}${site}`;
}
