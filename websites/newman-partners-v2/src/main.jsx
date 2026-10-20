import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import Colophon from './pages/Colophon.jsx'
import './index.css'
import { installWebsiteBuilderContentBridge } from '../../shared/builder-content-bridge.js'

installWebsiteBuilderContentBridge()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/colophon" element={<Colophon />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
