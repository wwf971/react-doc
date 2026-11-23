import fs from 'node:fs';
import {
  docManagedDocFind,
  docManagedRootRead,
  docManagedTextRead,
  docManagedTextWrite,
  type DocManagedDoc,
  type DocManagedRoot,
} from './doc-managed-store.ts';

// One door to the text of a document of the source (design:
// doc_page_impl_doc_managed.md#reading-and-writing): a file of a folder is
// read and written on disk, a managed document through the store of its
// virtual root (doc-managed-store.ts). Everything of the development server
// and of a build that reads or writes a document (the source api, the edit
// api, the link index, the attachment and pruning scans, the manifest) goes
// through here, so a managed document is read as a file is, whatever its
// mode and form.

// what an entry of the source says of a managed document: its root and itself
export type SourceEntryManaged = { rootDir: string; doc: DocManagedDoc };

export type SourceEntryAccessible = { absPath: string; managed?: SourceEntryManaged };

export function sourceEntryTextRead(entry: SourceEntryAccessible): string {
  if (entry.managed) return docManagedTextRead(entry.managed.doc);
  return fs.readFileSync(entry.absPath, 'utf-8');
}

export function sourceEntryBytesRead(entry: SourceEntryAccessible): Buffer {
  if (entry.managed) return Buffer.from(docManagedTextRead(entry.managed.doc), 'utf-8');
  return fs.readFileSync(entry.absPath);
}

// the text written; a managed document is found again in its root first (a
// write of another tab may have changed its files since the scan)
export function sourceEntryTextWrite(entry: SourceEntryAccessible, text: string): void {
  if (!entry.managed) {
    fs.writeFileSync(entry.absPath, text, 'utf-8');
    return;
  }
  const { root, doc } = sourceEntryManagedNowGet(entry.managed);
  const docWritten = docManagedTextWrite(root, doc, text);
  entry.managed.doc = docWritten;
  entry.absPath = docWritten.fileMain;
}

// the root and the document as they are on disk now
export function sourceEntryManagedNowGet(managed: SourceEntryManaged): { root: DocManagedRoot; doc: DocManagedDoc } {
  const root = docManagedRootRead(managed.rootDir);
  const doc = docManagedDocFind(root, managed.doc.record.docId);
  if (!doc) throw Object.assign(new Error(`the managed document ${managed.doc.record.path} is no longer in its root`), { code: -3 });
  return { root, doc };
}

// the files on disk a document is made of: the file itself, or every file of a managed document
export function sourceEntryFileListGet(entry: SourceEntryAccessible): string[] {
  return entry.managed ? [...entry.managed.doc.fileList] : [entry.absPath];
}
