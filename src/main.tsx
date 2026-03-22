import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-mono/400.css'
import './index.css'
import App from './App.tsx'

function installMobileZoomLock() {
  let lastTouchEnd = 0

  const preventGesture = (event: Event) => {
    event.preventDefault()
  }

  const preventMultiTouchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault()
    }
  }

  const preventDoubleTapZoom = (event: TouchEvent) => {
    const now = Date.now()
    if (now - lastTouchEnd <= 300) {
      event.preventDefault()
    }
    lastTouchEnd = now
  }

  document.addEventListener('gesturestart', preventGesture, { passive: false })
  document.addEventListener('gesturechange', preventGesture, { passive: false })
  document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false })
  document.addEventListener('touchend', preventDoubleTapZoom, { passive: false })
}

installMobileZoomLock()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
