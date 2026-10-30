import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error Boundary — ловит необработанные ошибки при рендере (например,
 * краш роутера при отрисовке связей) и показывает понятный экран вместо
 * белого «все объекты исчезли».
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // kein side effect, просто логируем для отладки
    console.error('[ErrorBoundary] caught error:', error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const message = this.state.error?.message ?? 'Неизвестная ошибка рендеринга';
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: '#fff3f3',
            color: '#8c1d1d',
            padding: 24,
            fontFamily: 'sans-serif',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            maxWidth: 700,
            margin: '40px auto',
            border: '1px solid #ffc7c7',
            borderRadius: 8,
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>Ошибка отрисовки схемы</h2>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              margin: 0,
              background: '#f7eaea',
              padding: 10,
              borderRadius: 4,
            }}
          >
            {message}
          </pre>
          <button
            onClick={() => {
              window.location.reload();
            }}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              background: '#d32f2f',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 14,
            }}
          >
            Перезагрузить страницу
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
