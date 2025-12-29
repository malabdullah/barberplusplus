import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { loggingService } from '../services/logging.service';

/**
 * Custom hook for logging within React components
 * Provides convenient logging methods and automatic navigation tracking
 * @param {string} componentName - Name of the component using this hook
 */
export function useLogger(componentName) {
  const location = useLocation();
  const prevLocation = useRef(location.pathname);

  // Track navigation changes
  useEffect(() => {
    if (prevLocation.current !== location.pathname) {
      loggingService.logNavigation(prevLocation.current, location.pathname);
      prevLocation.current = location.pathname;
    }
  }, [location.pathname]);

  /**
   * Log a CRUD action
   */
  const logAction = useCallback(
    (action, entityType, entityId, message, metadata) => {
      loggingService.logAction(
        action,
        entityType,
        entityId,
        message || `${action} ${entityType}`,
        { ...metadata, component: componentName }
      );
    },
    [componentName]
  );

  /**
   * Log an error with component context
   */
  const logError = useCallback(
    (error, context = {}) => {
      loggingService.logError(error, {
        ...context,
        metadata: { ...context.metadata, component: componentName },
      });
    },
    [componentName]
  );

  /**
   * Log info message
   */
  const logInfo = useCallback(
    (message, metadata = {}) => {
      loggingService.info(message, {
        metadata: { ...metadata, component: componentName },
      });
    },
    [componentName]
  );

  /**
   * Log warning message
   */
  const logWarn = useCallback(
    (message, metadata = {}) => {
      loggingService.warn(message, {
        metadata: { ...metadata, component: componentName },
      });
    },
    [componentName]
  );

  /**
   * Log debug message (development only)
   */
  const logDebug = useCallback(
    (message, metadata = {}) => {
      loggingService.debug(message, {
        metadata: { ...metadata, component: componentName },
      });
    },
    [componentName]
  );

  return {
    logAction,
    logError,
    logInfo,
    logWarn,
    logDebug,
  };
}

export default useLogger;
