import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORTAL_DOC_NAME, portalDeclareListOfObjectGet, portalDeclareListRead, portalDeclareListResolve, portalDeviceGet, portalDeviceIsFit, portalDocAliasGet,
  portalDocIdBuild, portalGroupListBuild, portalIdBuild, portalIdSplit, portalListBuild, portalLocationRead, portalLocationSearchBuild, portalSearch,
} from './doc-portal.js';

// Portals: the pure part (doc_page_impl_portal.md): ids, declarations, the registry, the location.

const read = (value, option) => {
  const problemList = [];
  const portalList = portalDeclareListRead(value, 'portalList', (message) => problemList.push(message), option);
  return { portalList, problemList };
};

test('a portal is named by its provider and its name', () => {
  assert.equal(portalIdBuild('frontend:w5j7ozoijzl', 'archive'), 'frontend:w5j7ozoijzl/archive');
  assert.deepEqual(portalIdSplit('frontend:w5j7ozoijzl/archive'), { providerRef: 'frontend:w5j7ozoijzl', name: 'archive' });
  assert.deepEqual(portalIdSplit('archive'), { providerRef: '', name: '' });
  assert.deepEqual(portalIdSplit('frontend:x/'), { providerRef: '', name: '' });
  assert.deepEqual(portalIdSplit('frontend:x/a b'), { providerRef: '', name: '' });
  assert.equal(portalDocIdBuild('example'), 'docPage:example/doc');
  assert.equal(portalDocAliasGet('docPage:example/doc'), 'example');
  assert.equal(portalDocAliasGet('frontend:x/doc'), undefined);
  assert.equal(portalDocAliasGet('docPage:example/other'), undefined);
});

test('a declaration is read key by key, and what is wrong leaves out its portal only', () => {
  const { portalList, problemList } = read([
    { id: 'archive', label: 'Archive', icon: 'archive', color: '#2f6f5e', comp: 'CvPortalArchive', param: { density: 'compact' }, deviceList: ['browser', 'desktop'] },
    { id: 'bad id', comp: 'X' },
    { id: 'doc', comp: 'X' },
    { id: 'archive', comp: 'Again' },
    { id: 'nocomp' },
    { id: 'param', comp: 'X', param: [1] },
    'text',
    { id: 'room', comp: 'CvPortalRoom', deviceList: ['browser', 'headset'], extra: 1 },
  ]);
  assert.deepEqual(portalList.map((one) => one.id), ['archive', 'room']);
  assert.deepEqual(portalList[0], { id: 'archive', label: 'Archive', icon: 'archive', color: '#2f6f5e', comp: 'CvPortalArchive', param: { density: 'compact' }, deviceList: ['browser', 'desktop'] });
  // a device of its own is kept, and told
  assert.deepEqual(portalList[1].deviceList, ['browser', 'headset']);
  assert.equal(problemList.length, 8);
  assert.match(problemList.join('\n'), /"doc" is the portal of the documents/);
  assert.match(problemList.join('\n'), /declared twice/);
  assert.match(problemList.join('\n'), /unknown key "extra"/);
  assert.match(problemList.join('\n'), /names headset/);
  assert.deepEqual(read('x').portalList, []);
});

test('portal.yaml of an object may adjust or switch off without naming a component', () => {
  const { portalList, problemList } = read([{ id: 'archive', isDisabled: true }, { id: 'room', label: 'My room' }], { isCompRequired: false });
  assert.deepEqual(portalList, [{ id: 'archive', isDisabled: true }, { id: 'room', label: 'My room' }]);
  assert.deepEqual(problemList, []);
});

test('the portals of a type are its own, then its ancestors, a nearer id hiding a farther one', () => {
  const portalListByType = {
    'cv.jp': [{ id: 'archive', comp: 'A' }],
    'cv.base': [{ id: 'archive', comp: 'Old' }, { id: 'room', comp: 'R' }],
  };
  assert.deepEqual(portalDeclareListResolve('cv.jp', ['cv.base', 'frontend.object'], portalListByType), [
    { id: 'archive', comp: 'A', typeId: 'cv.jp' },
    { id: 'room', comp: 'R', typeId: 'cv.base' },
  ]);
  assert.deepEqual(portalDeclareListResolve('other', [], portalListByType), []);
});

test('an object provides the portals of its type as it adjusts them, and its own', () => {
  const ofType = [{ id: 'archive', label: 'Archive', comp: 'A', param: { a: 1, b: 2 }, typeId: 'cv.jp' }, { id: 'room', comp: 'R', typeId: 'cv.jp' }];
  const provided = portalDeclareListOfObjectGet(ofType, [
    { id: 'archive', label: 'My archive', param: { b: 3 } },
    { id: 'room', isDisabled: true },
    { id: 'desk', comp: 'D' },
    { id: 'lost' },
  ]);
  assert.deepEqual(provided.portalList, [
    { id: 'archive', label: 'My archive', comp: 'A', param: { a: 1, b: 3 }, typeId: 'cv.jp', isOwn: false },
    { id: 'desk', comp: 'D', param: {}, isOwn: true },
  ]);
  assert.equal(provided.problemList.length, 1);
  assert.match(provided.problemList[0], /lost names no component/);
  assert.deepEqual(portalDeclareListOfObjectGet(ofType, undefined).portalList.map((one) => one.id), ['archive', 'room']);
});

const docPageList = [{ alias: 'cv', title: 'cv' }, { alias: 'example', title: 'Example' }];
const provideList = [
  { providerRef: 'frontend:aaa', providerLabel: 'Papers', docPageAlias: 'cv', portalList: [{ id: 'archive', label: 'Archive', comp: 'A' }, { id: 'room', label: 'Room', comp: 'R', deviceList: ['browser'] }] },
  { providerRef: 'frontend:bbb', providerLabel: 'Papers of 2025', docPageAlias: 'cv', portalList: [{ id: 'archive', label: 'Archive', comp: 'A' }] },
  { providerRef: 'frontend:ccc', providerLabel: 'Reading list', docPageAlias: 'example', portalList: [{ id: 'library', label: 'Library', comp: 'L' }] },
  { providerRef: 'frontend:ddd', providerLabel: 'Stray', docPageAlias: 'gone', portalList: [{ id: 'x', label: 'X', comp: 'X' }] },
];

test('the registry: the documents of every doc page, then what objects provide, by doc page', () => {
  const portalList = portalListBuild({ docPageList, provideList });
  assert.deepEqual(portalList.map((one) => one.id), [
    'docPage:cv/doc', 'frontend:aaa/archive', 'frontend:aaa/room', 'frontend:bbb/archive',
    'docPage:example/doc', 'frontend:ccc/library',
    'frontend:ddd/x',
  ]);
  assert.equal(portalList[0].isBuiltIn, true);
  assert.equal(portalList[0].name, PORTAL_DOC_NAME);
  assert.equal(portalList[1].providerKind, 'objectFrontend');
  assert.deepEqual(portalList[2].deviceList, ['browser']);
});

test('ranks order the portals of a doc page, hidden ones are left out, a registered one joins', () => {
  const portalList = portalListBuild({
    docPageList,
    provideList,
    registeredList: [{ id: 'host:app/console', label: 'Console', docPageAlias: 'example', comp: 'C' }, { id: 'no-name' }],
    hiddenIdList: ['docPage:example/doc', 'frontend:ddd/x'],
    rankById: { 'frontend:bbb/archive': 'c', 'frontend:aaa/room': 'e' },
  });
  assert.deepEqual(portalList.map((one) => one.id), [
    'docPage:cv/doc', 'frontend:bbb/archive', 'frontend:aaa/room', 'frontend:aaa/archive',
    'frontend:ccc/library', 'host:app/console',
  ]);
  assert.equal(portalList.at(-1).providerKind, 'registered');
  assert.equal(portalList.at(-1).name, 'console');
});

test('the switcher lists a group per doc page, and tells two portals of one label apart', () => {
  const groupList = portalGroupListBuild(portalListBuild({ docPageList, provideList }), { cv: 'cv', example: 'Example' });
  assert.deepEqual(groupList.map((group) => [group.docPageAlias, group.title, group.portalList.length]), [['cv', 'cv', 4], ['example', 'Example', 2], ['gone', 'gone', 1]]);
  assert.deepEqual(groupList[0].portalList.map((one) => [one.label, one.labelDetail]), [['Documents', ''], ['Archive', 'Papers'], ['Room', ''], ['Archive', 'Papers of 2025']]);
});

test('a search finds by every word, in the label, the description, the provider, the doc page', () => {
  const portalList = portalListBuild({ docPageList, provideList });
  const titleByAlias = { cv: 'cv', example: 'Example' };
  assert.deepEqual(portalSearch(portalList, 'arch', titleByAlias).map((one) => one.id), ['frontend:aaa/archive', 'frontend:bbb/archive']);
  assert.deepEqual(portalSearch(portalList, 'archive 2025', titleByAlias).map((one) => one.id), ['frontend:bbb/archive']);
  assert.deepEqual(portalSearch(portalList, 'example', titleByAlias).map((one) => one.id), ['docPage:example/doc', 'frontend:ccc/library']);
  assert.equal(portalSearch(portalList, '  ', titleByAlias).length, portalList.length);
  assert.deepEqual(portalSearch(portalList, 'zzz', titleByAlias), []);
});

test('the location names a portal and the place inside it', () => {
  assert.deepEqual(portalLocationRead('?portal=frontend%3Aaaa%2Farchive&at=%2Fexample%2Fcv'), { portalId: 'frontend:aaa/archive', at: '/example/cv' });
  assert.deepEqual(portalLocationRead('?doc=%2Fa'), { portalId: '', at: '' });
  assert.deepEqual(portalLocationRead('?portal=nonsense'), { portalId: '', at: '' });
  // a portal shown: the route of the documents is taken out, other parameters stay
  assert.equal(portalLocationSearchBuild('?doc=%2Fa&x=1', 'frontend:aaa/archive', '/example'), '?x=1&portal=frontend%3Aaaa%2Farchive&at=%2Fexample');
  assert.equal(portalLocationSearchBuild('?portal=frontend%3Aaaa%2Farchive&at=%2Fold', 'frontend:aaa/room'), '?portal=frontend%3Aaaa%2Froom');
  // the documents: both taken out
  assert.equal(portalLocationSearchBuild('?portal=frontend%3Aaaa%2Farchive&at=%2Fold&doc=%2Fa', ''), '?doc=%2Fa');
  assert.equal(portalLocationSearchBuild('?portal=frontend%3Aaaa%2Farchive', ''), '');
});

test('a device by the stipulated words, and what a portal is made for', () => {
  assert.equal(portalDeviceGet({ width: 1440 }), 'browser');
  assert.equal(portalDeviceGet({ width: 390 }), 'mobile');
  assert.equal(portalDeviceGet({ width: 820, isTouch: true }), 'mobile');
  assert.equal(portalDeviceGet({ width: 1440, userAgent: 'Mozilla/5.0 Electron/30' }), 'desktop');
  assert.equal(portalDeviceIsFit({ deviceList: [] }, 'mobile'), true);
  assert.equal(portalDeviceIsFit({ deviceList: ['browser', 'desktop'] }, 'mobile'), false);
  assert.equal(portalDeviceIsFit({ deviceList: ['browser'] }, 'browser'), true);
});
