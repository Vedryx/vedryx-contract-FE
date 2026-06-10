import { Brand } from '../../ui/Brand/Brand.jsx'
import './Navbar.css'

export function Nav() {
  return (
    <nav className="nav">
      <Brand />
      <div className="nav-links">
        <a href="#problem">The Difference</a>
        <a href="#engine">How It Works</a>
        <a href="#stack">Technologies</a>
        <a href="#why">Why Vedryx Core</a>
      </div>
      <div className="nav-cta">
        <a href="#submit" className="btn btn-ghost nav-btn">Contact Vedryx</a>
        <a href="#submit" className="btn btn-primary nav-btn">Request Callback <span className="arrow">→</span></a>
      </div>
    </nav>
  )
}
