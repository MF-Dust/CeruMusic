import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { TDesignResolver } from '@tdesign-vue-next/auto-import-resolver'
import wasm from 'vite-plugin-wasm'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    target: 'esnext',
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    rollupOptions: {
      output: {
        entryFileNames: 'script/[name]-[hash].js',
        chunkFileNames: 'script/[name]-[hash].js',
        assetFileNames(chunkInfo) {
          if (chunkInfo.names[0].endsWith('.css')) return 'style/[name]-[hash].css'
          const imgReg = /\.(png|jpg|jpeg|gif|svg|webp)$/
          if (imgReg.test(chunkInfo.names[0])) return 'images/[name]-[hash].[ext]'
          return 'assets/[name]-[hash].[ext]'
        },
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (
            /[\\/]node_modules[\\/]@vue[\\/]/.test(id) ||
            /[\\/]node_modules[\\/]vue[\\/]/.test(id)
          ) {
            return 'vendor-vue'
          }
          if (
            /[\\/]node_modules[\\/]pinia[\\/]/.test(id) ||
            /[\\/]node_modules[\\/]vue-router[\\/]/.test(id)
          ) {
            return 'vendor-vue'
          }
          if (/[\\/]node_modules[\\/]tdesign-vue-next[\\/]/.test(id)) {
            return 'vendor-tdesign'
          }
          if (/[\\/]node_modules[\\/]@applemusic-like-lyrics[\\/]/.test(id)) {
            return 'vendor-amll'
          }
          if (
            /[\\/]node_modules[\\/]@tensorflow[\\/]/.test(id) ||
            /[\\/]node_modules[\\/]nsfwjs[\\/]/.test(id)
          ) {
            return 'vendor-tfjs'
          }
          if (/[\\/]node_modules[\\/]@logto[\\/]/.test(id)) {
            return 'vendor-logto'
          }
          if (
            /[\\/]node_modules[\\/]socket\.io-client[\\/]/.test(id) ||
            /[\\/]node_modules[\\/]engine\.io-client[\\/]/.test(id)
          ) {
            return 'vendor-socketio'
          }
          return 'vendor-misc'
        }
      }
    }
  },
  plugins: [
    vue(),
    vueDevTools(),
    wasm(),
    topLevelAwait(),
    AutoImport({
      resolvers: [
        TDesignResolver({
          library: 'vue-next'
        })
      ],
      imports: [
        'vue',
        {
          'naive-ui': ['useDialog', 'useMessage', 'useNotification', 'useLoadingBar']
        }
      ],
      dts: true
    }),
    Components({
      resolvers: [
        TDesignResolver({
          library: 'vue-next'
        }),
        NaiveUiResolver()
      ],
      dts: true
    })
  ],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@assets': resolve(__dirname, 'src/renderer/src/assets'),
      '@components': resolve(__dirname, 'src/renderer/src/components'),
      '@services': resolve(__dirname, 'src/renderer/src/services'),
      '@types': resolve(__dirname, 'src/renderer/src/types'),
      '@store': resolve(__dirname, 'src/renderer/src/store'),
      '@common': resolve(__dirname, 'src/common')
    }
  }
})
