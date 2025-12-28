import React, { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log error to monitoring service in production
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px 24px',
          textAlign: 'center',
          minHeight: '300px',
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          margin: '24px',
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'var(--status-error-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '24px',
          }}>
            <AlertTriangle size={32} strokeWidth={1.5} style={{ color: 'var(--status-error)' }} />
          </div>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: 'var(--text-primary)',
            marginBottom: '8px',
          }}>
            Something went wrong
          </h2>
          <p style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            marginBottom: '24px',
            maxWidth: '400px',
          }}>
            {this.props.message || 'An unexpected error occurred. Please try again.'}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              background: 'var(--accent-primary)',
              color: 'var(--bg-primary)',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={16} strokeWidth={2} />
            Try Again
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details style={{
              marginTop: '24px',
              textAlign: 'left',
              width: '100%',
              maxWidth: '600px',
            }}>
              <summary style={{
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
                fontSize: '12px',
              }}>
                Error Details (Development Only)
              </summary>
              <pre style={{
                marginTop: '12px',
                padding: '12px',
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                fontSize: '11px',
                color: 'var(--status-error)',
                overflow: 'auto',
                maxHeight: '200px',
              }}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
