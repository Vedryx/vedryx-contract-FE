import { Link } from 'react-router-dom'
import './Brand.css'

// Explicit intrinsic dimensions on the logo image satisfy the PSI
// "unsized-images" audit and reserve layout space (less CLS).
// fetchpriority="high" pairs with the <link rel="preload" fetchpriority="high">
// in index.html so the LCP element (nav logo) lands on the first paint.
// width/height = the on-design intrinsic SVG box; CSS in Brand.css governs
// the rendered size.
export function Brand() {
  return (
    <Link to="/" className="brand">
      <img
        src="/Vedryx_logo.svg"
        alt="Vedryx Logo"
        className="brand-logo"
        width="138"
        height="32"
        fetchPriority="high"
        decoding="async"
      />
    </Link>
  )
}
