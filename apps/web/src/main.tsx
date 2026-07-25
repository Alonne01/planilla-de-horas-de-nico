import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { capturarClaveDebug } from './lib/debugClave'

// Antes de montar nada: el router redirige a /login con <Navigate replace>, que
// se lleva puesto el query string, así que la clave hay que tomarla acá.
capturarClaveDebug()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
