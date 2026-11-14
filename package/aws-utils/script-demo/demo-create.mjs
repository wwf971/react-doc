// Makes a small doc page that uses a deployment of the two backends of the package aws-utils
// (doc/first-use.md): an auth provider, a storage point, and a notebook whose partition "cloud" is
// held by that point, with two documents showing them. It is for trying the package out with a
// backend of one's own, somewhere git does not track: the values of a deployment belong to
// whoever deployed it.
//
//   cd main/frontend
//   node --import tsx --import ./src/lib/node-test-register.js ../../package/aws-utils/script-demo/demo-create.mjs \
//       --out ../../temporary/aws-demo --aws-oa ../../../aws_oa
//   node cli/doc-cli.js dev ../../temporary/aws-demo
//
//   --out DIR               the folder of the doc page to make (it must not hold a doc page yet)
//   --aws-oa DIR            the repository of the backends: the values are read from the config_gen.yaml
//                           its ensure scripts wrote (_0_auth_cognito, _5_doc_storage)
//   --region, --user-pool-id, --client-id, --account-api-url, --storage-url
//                           the values one by one, instead of --aws-oa or over it
//
// The objects are made by the same code the development server runs for the Frontend objects tab
// (its routes object-frontend/create and meta/set), so what is written is what the page writes.
// It runs from main/frontend, where tsx (which reads the plugin's TypeScript) is installed; the second
// --import is the loader the plugin's own tests use for what the plugin imports beside TypeScript.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assetStoreCreate } from '../../../main/frontend/plugin/doc-asset-store.ts';
import { docAssetMiddlewareCreate } from '../../../main/frontend/plugin/doc-asset-server.ts';
import { docAssetConfigLoad, loadConfigDoc } from '../../../main/frontend/plugin/doc-source.ts';
import { objectFrontendConfigOfDocPageListGet } from '../../../main/frontend/plugin/doc-object-frontend.ts';

const DIR_PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_FRONTEND = path.resolve(DIR_PACKAGE, '../../main/frontend');
const yaml = createRequire(path.join(DIR_FRONTEND, 'package.json'))('yaml');

const POINT_ID = 'cloud';
const TYPE_NOTEBOOK = 'aws-demo.notebook';

function argMapRead(argList) {
  const argMap = {};
  for (let index = 0; index < argList.length; index += 2) {
    const key = argList[index];
    if (!key.startsWith('--') || argList[index + 1] === undefined) throw new Error(`an option is "--name value": ${key}`);
    argMap[key.slice(2)] = argList[index + 1];
  }
  return argMap;
}

// the five values of a deployment: from the repository of the backends, each replaced by its own option
function deployValueRead(argMap) {
  const value = { region: '', userPoolId: '', clientId: '', accountApiUrl: '', storageUrl: '' };
  if (argMap['aws-oa']) {
    const dirAwsOa = path.resolve(argMap['aws-oa']);
    const genRead = (dirSub) => {
      const file = path.join(dirAwsOa, dirSub, 'config_gen.yaml');
      if (!fs.existsSync(file)) throw new Error(`${file} is not there: run ensure_architect.py of ${dirSub} first`);
      return yaml.parse(fs.readFileSync(file, 'utf-8')) ?? {};
    };
    Object.assign(value, genRead('_0_auth_cognito').auth_provider ?? {});
    value.storageUrl = genRead('_5_doc_storage').doc_storage?.api_endpoint ?? '';
  }
  const optionByKey = { region: 'region', userPoolId: 'user-pool-id', clientId: 'client-id', accountApiUrl: 'account-api-url', storageUrl: 'storage-url' };
  for (const [key, option] of Object.entries(optionByKey)) if (argMap[option]) value[key] = argMap[option];
  const missingList = Object.entries(optionByKey).filter(([key]) => !value[key]).map(([, option]) => `--${option}`);
  if (missingList.length > 0) throw new Error(`missing: ${missingList.join(', ')} (or --aws-oa DIR, the repository whose ensure scripts wrote them)`);
  return value;
}

// one request of the asset api of the development server, answered { code, message, data }
function requestRun(middleware, route, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = `/__doc-asset/${route}`;
    const res = { statusCode: 200, setHeader: () => {}, end: (text) => resolve(JSON.parse(String(text))) };
    middleware(req, res, () => resolve({ code: -1, message: `no route ${route}`, data: null }));
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body ?? {})));
      req.emit('end');
    });
  });
}

async function main() {
  const argMap = argMapRead(process.argv.slice(2));
  if (!argMap.out) throw new Error('--out DIR: the folder of the doc page to make');
  const dirOut = path.resolve(argMap.out);
  const dirMeta = path.join(dirOut, '.doc-page');
  if (fs.existsSync(dirMeta)) throw new Error(`${dirOut} holds a doc page already: name another folder, or remove it first`);
  const value = deployValueRead(argMap);
  const alias = path.basename(dirOut).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  fs.mkdirSync(dirMeta, { recursive: true });

  fs.writeFileSync(path.join(dirMeta, 'entry.yaml'), [
    '# A doc page made by package/aws-utils/script-demo/demo-create.mjs: it uses a deployment of the',
    '# backends of the package aws-utils (package/aws-utils/doc/first-use.md).',
    'docEntry:',
    '  title: "aws-utils: demonstration"',
    `  homeDoc: ~${alias}/README.md`,
    '# the package bringing the storage type, the auth kind and the notebook',
    'packageList:',
    '  - name: aws-utils',
    'source:',
    '  - action: addFolder',
    `    alias: ${alias}`,
    '    path: ..',
    '    collect: recursive',
    'sidePanelById:',
    '  main:',
    '    tree:',
    `      - doc: ~${alias}/README.md`,
    '        text: Cloud notebook',
    `      - doc: ~${alias}/admin.md`,
    '        text: Account admin',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dirMeta, 'type.yaml'), [
    '# The notebook of this doc page: the notebook of the package, with its partition "cloud" bound',
    `# to the storage point ${POINT_ID} (asset-storage.yaml) when it is made.`,
    'typeList:',
    `  - id: ${TYPE_NOTEBOOK}`,
    '    label: Cloud notebook',
    '    extendList: [aws-utils.notebook]',
    '    partitionList:',
    '      - { id: local, label: This doc page, description: "notes in the folders of the doc page", isDefault: true }',
    `      - { id: cloud, label: Cloud, description: "notes of the person signed in, kept at the storage service", storagePoint: ${POINT_ID} }`,
    '',
  ].join('\n'));
  const storageFileWrite = (providerRef) => fs.writeFileSync(path.join(dirMeta, 'asset-storage.yaml'), [
    '# The storage points of this doc page (main/doc_page_impl_asset_storage.md#declaring-storage-points).',
    'storagePointList:',
    '  # a storage service on AWS, reached by the page itself as the person signed in to the auth provider',
    `  - id: ${POINT_ID}`,
    '    type: aws-utils.remote',
    '    label: Cloud',
    `    config: { url: ${JSON.stringify(value.storageUrl)} }`,
    `    auth: { provider: ${JSON.stringify(providerRef)} }`,
    '',
  ].join('\n'));
  // the point names its auth provider once that object exists
  storageFileWrite('frontend:0');

  // the development server's own routes, over the files just written. the config names where the
  // packages are, as the command line of react-doc does
  const configFile = path.join(dirOut, 'config.demo-create.yaml');
  fs.writeFileSync(configFile, `docEntry:\n  dir: .\npackageSearchDirList:\n  - ${JSON.stringify(path.dirname(DIR_PACKAGE))}\n`);
  let isMade = false;
  try {
    const middleware = docAssetMiddlewareCreate({
      endpoint: '/__doc-asset',
      storeGet: () => assetStoreCreate(docAssetConfigLoad(configFile)),
      rootAbsPathByPathGet: () => new Map(),
      usageScan: () => [],
      objectFrontendConfigGet: () => {
        const configDoc = loadConfigDoc(configFile);
        const assetConfig = docAssetConfigLoad(configFile);
        const assetFolderByAlias = new Map(assetConfig.docPageList.map((docPage) => [docPage.alias, docPage.folderDefault]));
        return objectFrontendConfigOfDocPageListGet(configDoc.docEntry.docPageList, dirOut, assetFolderByAlias, configDoc.typeDeclared.typeList, assetConfig.storage);
      },
    });
    const docPageAlias = loadConfigDoc(configFile).docEntry.docPageList[0].alias;
    const objectCreate = async (typeId, name, description, metadata) => {
      const created = await requestRun(middleware, 'object-frontend/create', { docPageAlias, typeId, name, description });
      if (created.code !== 0) throw new Error(`the object ${name} was not made: ${created.message}`);
      if (metadata) {
        const set = await requestRun(middleware, 'object-frontend/meta/set', { id: created.data.id, metadata });
        if (set.code !== 0) throw new Error(`the metadata of ${name} was not written: ${set.message}`);
      }
      return created.data.id;
    };
    const idProvider = await objectCreate('aws-utils.auth-cognito', 'Account', 'signs people in with the Cognito user pool of this deployment', {
      auth: { region: value.region, userPoolId: value.userPoolId, clientId: value.clientId, accountApiUrl: value.accountApiUrl },
    });
    const idNotebook = await objectCreate(TYPE_NOTEBOOK, 'Notebook', 'notes in the folders of the doc page, and notes kept in the cloud');
    storageFileWrite(`frontend:${idProvider}`);

    const block = (object, mode, param) => ['<!--renderComp=ObjectFrontend-->', '```yaml', `object: frontend:${object}`, `mode: ${mode}`, ...(param ? ['param:', ...param] : []), '```'].join('\n');
    fs.writeFileSync(path.join(dirOut, 'README.md'), [
      '# Cloud Notebook',
      '',
      `This doc page uses a deployment of the backends of the package aws-utils. Its storage point \`${POINT_ID}\` keeps the partition **Cloud** of the notebook below at the storage service; the auth provider signs you in to it.`,
      '',
      '## The account',
      '',
      'Who is signed in. **Sign in** opens the dialog; without an account, **Ask for an account…** sends a request to the account admin.',
      '',
      block(idProvider, 'session'),
      '',
      '## The notebook',
      '',
      'The partition **Cloud** is read from the storage service once you are signed in, and written there: its notes are yours on every machine. The partition **This doc page** lies in the folders of this doc page. In both, notes are added and changed while the document is in edit mode (**Edit**, at the top).',
      '',
      block(idNotebook, 'notes', ['  partition: cloud']),
      '',
      '## What else to try',
      '',
      '- Settings panel, **Asset service**, *Points the page reaches itself*: the session of the point, **Check**, what the browser keeps of it, **Refresh** and **Clear**, and the account and the space at the storage service.',
      '- Settings panel, **Frontend objects**, the notebook, *Partitions*: **Storage…** moves *This doc page* to the cloud and back, with or without keeping a copy; **Copy…** copies the notes of one partition into the other.',
      '- Open this page in another browser and sign in: the notes of **Cloud** are there.',
      '- `react-doc build <this folder> --out notebook.html`: the built page signs in and reads **Cloud** with no server (notes are changed in edit mode, which a built page does not have).',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dirOut, 'admin.md'), [
      '# Account Admin',
      '',
      'The account console: requests for an account approved or rejected, accounts issued, changed, disabled and deleted. It is a block of this document like any other, and works with the session the auth provider holds: sign in above it with an account holding the role `account-admin` (an account like any other, marked with that role). An account admin signs in with an authenticator app; one without it is offered to turn it on first.',
      '',
      block(idProvider, 'admin'),
      '',
    ].join('\n'));
    console.log(`made ${dirOut}`);
    console.log(`  auth provider   frontend:${idProvider}   (user pool ${value.userPoolId})`);
    console.log(`  notebook        frontend:${idNotebook}`);
    console.log(`  storage point   ${POINT_ID} -> ${value.storageUrl}`);
    console.log(`open it:  node ${path.relative(process.cwd(), path.join(DIR_FRONTEND, 'cli/doc-cli.js'))} dev ${path.relative(process.cwd(), dirOut)}`);
    isMade = true;
  } finally {
    fs.rmSync(configFile, { force: true });
    // a doc page made halfway is not left behind: the next run starts from nothing
    if (!isMade) fs.rmSync(dirMeta, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`demo-create: ${error.message}`);
  process.exit(1);
});
