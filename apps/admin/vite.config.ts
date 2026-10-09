import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({esbuild:{jsx:"automatic"},resolve:{alias:{'next/link':resolve(__dirname,'../../packages/ui/navigation.tsx'),'next/navigation':resolve(__dirname,'../../packages/ui/navigation.tsx')}},build:{outDir:'dist'}});
