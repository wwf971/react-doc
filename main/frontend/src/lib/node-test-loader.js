import { transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const reactParentURL = new URL('./mdx-compile.js', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === 'react'
    || specifier === 'react-dom'
    || specifier.startsWith('react/')
    || specifier.startsWith('react-dom/')
    // the diagram store of built-in/ reads React Flow's node changes; it is a
    // dependency of the frontend, not found from beside built-in/
    || specifier === '@xyflow/react'
    // one mobx, one observer binding: a component of built-in/ rendered in a
    // test must see the react of the frontend through mobx-react-lite, not
    // another copy found above the package
    || specifier === 'mobx'
    || specifier === 'mobx-react-lite'
  ) {
    return nextResolve(specifier, { ...context, parentURL: reactParentURL });
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // what vite does for "?raw": the text of the file
  if (url.startsWith('file:') && url.endsWith('?raw')) {
    return {
      format: 'module',
      source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8'))};`,
      shortCircuit: true,
    };
  }
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      source: 'export default {};',
      shortCircuit: true,
    };
  }
  if (url.startsWith('file:') && url.endsWith('.jsx')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const transformed = transformSync(source, {
      loader: 'jsx',
      jsx: 'automatic',
      format: 'esm',
      sourcefile: fileURLToPath(url),
    });
    return {
      format: 'module',
      source: transformed.code,
      shortCircuit: true,
    };
  }
  if (url.startsWith('file:') && url.endsWith('.js') && !url.includes('/node_modules/')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    // what vite does for import.meta.glob (a folder of icons a series registers): here no file, so a
    // module using it loads in a test (the registry of every package, read by CardCompEntry.test.js)
    if (source.includes('import.meta.glob(')) {
      return {
        format: 'module',
        source: source.replaceAll('import.meta.glob(', '((..._glob) => ({}))('),
        shortCircuit: true,
      };
    }
    // a module of the component folders of a doc page is an ES module, as vite reads it: a doc page
    // has no package.json saying so, and node would read it as CommonJS
    if (url.includes('/.doc-page/')) {
      return { format: 'module', source, shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}
