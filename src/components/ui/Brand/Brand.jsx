import { Link } from 'react-router-dom'
import './Brand.css'

export function Brand() {
  return (
    <Link to="/" className="brand">
       <img src="/Vedryx_logo.svg" alt="Vedryx Logo" className="brand-logo" />
    </Link>
  )
}
