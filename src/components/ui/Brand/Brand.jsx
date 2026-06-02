import './Brand.css'

export function Brand() {
  return (
    <a className="brand" href="#top">
      <span className="mark">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2L21 7v10l-9 5-9-5V7l9-5z" stroke="#6d8bff" strokeWidth="1.3" />
          <path d="M7 9l5 3 5-3M12 12v6" stroke="#46d9ff" strokeWidth="1.3" />
          <circle cx="12" cy="12" r="1.6" fill="#9db4ff" />
        </svg>
      </span>
      Vedryx
    </a>
  )
}
