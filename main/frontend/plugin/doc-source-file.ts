import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Deleting files of the collected source, the file operation of the doc
// page source service layer that other routes call
// (doc_page_impl_source.md#creating-and-deleting-files). File creation is
// the source api's own route (doc-source.ts sourceFileCreate); a deletion
// always comes with a write of something else, so it is a step of that
// write, not a route of its own:
//
//   a block deleted with the files it offered     doc-edit-server.ts /source/apply
//   a side-panel item removed with its document   doc-edit-server.ts /side-panel/node
//
// a deleted file is not erased: it is renamed into a hidden backup beside
// it, `.{name}.{uuid}.deleted`, which the scan of the source never collects
// (sourceFileBackupNameIs) and which is restored by renaming it back.
//
//   sourceFileDeleteListResolve   the paths checked before anything moves:
//                                 a collected regular file each, none of
//                                 them protected
//   sourceFileBackupMove          the files renamed into their backups
//   sourceFileBackupRestore       the backups renamed back, in reverse order

export type SourceFileEntry = {
  absPath: string;
  internalPath: string;
};

export type SourceFileMoved = { file: string; backup: string };

// a request naming a file that cannot be deleted: answered before anything
// is touched
export class SourceFileDeleteRequestError extends Error {}

const BACKUP_SUFFIX = '.deleted';
// .{name}.{uuid}.deleted
const backupNamePattern = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.deleted$/;

// the file name is the backup of a deleted file
export function sourceFileBackupNameIs(name: string): boolean {
  return name.endsWith(BACKUP_SUFFIX) && backupNamePattern.test(name);
}

// every path resolved through the collected source, each file once. an
// unknown path, a path that is not a regular file (lstat: a symlink is not)
// or a protected file (the document a block deletion writes) refuses the
// whole request
export function sourceFileDeleteListResolve(
  pathList: string[],
  fileEntryList: SourceFileEntry[],
  absPathProtectedList: string[] = [],
): SourceFileEntry[] {
  const absPathProtectedSet = new Set(absPathProtectedList.map((item) => path.resolve(item)));
  const fileList: SourceFileEntry[] = [];
  const absPathSeen = new Set<string>();
  for (const internalPath of new Set(pathList)) {
    const fileEntry = fileEntryList.find((item) => item.internalPath === internalPath);
    if (!fileEntry) throw new SourceFileDeleteRequestError(`not a file of the collected source: ${internalPath}`);
    const absPath = path.resolve(fileEntry.absPath);
    if (absPathProtectedSet.has(absPath)) {
      throw new SourceFileDeleteRequestError(`the file being written cannot be deleted with it: ${internalPath}`);
    }
    let isFile = false;
    try {
      isFile = fs.lstatSync(absPath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) throw new SourceFileDeleteRequestError(`not a regular file: ${internalPath}`);
    if (absPathSeen.has(absPath)) continue;
    absPathSeen.add(absPath);
    fileList.push(fileEntry);
  }
  return fileList;
}

// renames every file into its backup. a failure on the way puts back what
// was moved, then rethrows
export function sourceFileBackupMove(fileList: SourceFileEntry[]): SourceFileMoved[] {
  const movedList: SourceFileMoved[] = [];
  try {
    for (const fileEntry of fileList) {
      const backup = path.join(path.dirname(fileEntry.absPath), `.${path.basename(fileEntry.absPath)}.${randomUUID()}${BACKUP_SUFFIX}`);
      fs.renameSync(fileEntry.absPath, backup);
      movedList.push({ file: fileEntry.absPath, backup });
    }
  } catch (error) {
    sourceFileBackupRestore(movedList);
    throw error;
  }
  return movedList;
}

// best effort: a backup that cannot be renamed back stays as it is
export function sourceFileBackupRestore(movedList: SourceFileMoved[]) {
  for (const moved of [...movedList].reverse()) {
    try {
      fs.renameSync(moved.backup, moved.file);
    } catch {
      // the file stays as its backup; nothing more can be done here
    }
  }
}
