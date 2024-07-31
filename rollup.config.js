import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'main.ts',
  output: {
    file: 'main.js',
    format: 'iife'
  },
  plugins: [
    nodeResolve(),
    typescript()
  ]
};
