import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
export default defineConfig({
  plugins:[react()], base:'/static/productivity/',
  define:{'process.env.NODE_ENV':'"production"'},
  resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
  css:{postcss:{plugins:[tailwindcss({content:[fileURLToPath(new URL('./src/**/*.{ts,tsx}',import.meta.url))],theme:{extend:{colors:{
    'bg-void':'var(--bg-void)','bg-panel':'var(--bg-panel)','bg-panel-alt':'var(--bg-panel-alt)','border-line':'var(--border-line)',
    'border-cyan':'var(--border-cyan)','accent-cyan':'var(--accent-cyan)','accent-cyan-dim':'var(--accent-cyan-dim)',
    'text-primary':'var(--text-primary)','text-secondary':'var(--text-secondary)','text-muted':'var(--text-muted)',
    'warn-amber':'var(--warn-amber)','alert-red':'var(--alert-red)'}}}}),autoprefixer()]}},
  build:{outDir:'../../static/productivity',emptyOutDir:true,minify:true,lib:{entry:'src/main.tsx',formats:['es'],fileName:'workspace',cssFileName:'workspace'}}
});
