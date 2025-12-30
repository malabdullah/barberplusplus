import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n' // Initialize i18n BEFORE App (AppContext depends on it)
import App from './App'
import { initGlobalErrorHandlers } from './utils/globalErrorHandler'
import './styles/index.css'

// Initialize global error handlers before React renders
initGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
