import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    optimizeDeps: {
      include: ['react', 'react-dom', '@supabase/supabase-js']
    },
    define: {
      // Make environment variables available at build time
      __WEBSOCKET_URL__: JSON.stringify(env.VITE_WEBSOCKET_URL),
      __NODE_ENV__: JSON.stringify(env.VITE_NODE_ENV || mode)
    },
    build: {
      // Optimize build for production
      minify: mode === 'production',
      sourcemap: mode === 'development',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            supabase: ['@supabase/supabase-js']
          }
        }
      }
    },
    server: {
      // Development server configuration
      port: 5173,
      host: true,
      cors: true
    },
    preview: {
      // Preview server configuration
      port: 4173,
      host: true
    }
  }
})
