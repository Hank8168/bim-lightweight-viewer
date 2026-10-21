import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Keep React and React DOM on one runtime when pnpm/npm install trees coexist.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
