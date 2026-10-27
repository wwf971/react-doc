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
  return nextLoad(url, context);
}
