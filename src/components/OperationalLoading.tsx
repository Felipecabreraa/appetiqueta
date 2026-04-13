export function OperationalLoading({ message }: { message: string }) {
  return (
    <div className="operational-app">
      <div className="operational-inner">
        <div className="operational-card operational-card--state operational-loading">
          <div className="operational-spinner" aria-hidden />
          <p className="operational-title operational-loading-title">{message}</p>
        </div>
      </div>
    </div>
  )
}
