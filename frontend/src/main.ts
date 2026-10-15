import { createApp } from 'vue'
import App from './App.vue'
import { installPreview } from './preview'
import '@codex-proxy/ui/styles.css'
import './utilities.css'
import './style.css'

if (import.meta.env.DEV) installPreview()
const theme = () => { document.documentElement.dataset.theme = window.codexProxyPlugin?.theme ?? 'light' }
theme()
window.addEventListener('codex-proxy-themechange', theme)
createApp(App).mount('#app')
