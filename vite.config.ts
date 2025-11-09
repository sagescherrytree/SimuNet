import rawPlugin from 'vite-raw-plugin';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    build: {
        target: 'esnext'
    },
    base: process.env.GITHUB_ACTIONS_BASE || undefined,
    plugins: [
        rawPlugin({
            fileRegex: /\.wgsl$/,
        }),
        react()
    ],
})
