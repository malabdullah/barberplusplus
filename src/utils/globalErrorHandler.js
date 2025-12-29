import { loggingService } from '../services/logging.service';

/**
 * Initialize global error handlers for uncaught errors and unhandled promise rejections
 */
export const initGlobalErrorHandlers = () => {
  // Handle uncaught JavaScript errors
  window.onerror = (message, source, lineno, colno, error) => {
    loggingService.logError(error || new Error(String(message)), {
      metadata: {
        source,
        lineno,
        colno,
        type: 'uncaught_error',
      },
    });
    return false; // Don't prevent default browser error handling
  };

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));

    loggingService.logError(error, {
      metadata: {
        type: 'unhandled_rejection',
        promise: true,
      },
    });
  });

  // Callback for React ErrorBoundary to use
  window.__logReactError = (error, errorInfo) => {
    loggingService.logError(error, {
      metadata: {
        type: 'react_error_boundary',
        componentStack: errorInfo?.componentStack,
      },
    });
  };
};

export default initGlobalErrorHandlers;
