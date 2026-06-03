export function Empty({ className = '', children }) {
  return (
    <section className={`relative z-10 mx-auto flex w-full max-w-[680px] flex-col items-center px-4 text-center ${className}`}>
      {children}
    </section>
  )
}

export function EmptyHeader({ className = '', children }) {
  return <header className={`flex flex-col items-center ${className}`}>{children}</header>
}

export function EmptyTitle({ className = '', children }) {
  return <h1 className={className}>{children}</h1>
}

export function EmptyDescription({ className = '', children }) {
  return <p className={className}>{children}</p>
}

export function EmptyContent({ className = '', children, style }) {
  return <div className={`mt-10 sm:mt-12 ${className}`} style={style}>{children}</div>
}
