import { register } from 'node:module';

await register('./node-test-loader.js', import.meta.url);
