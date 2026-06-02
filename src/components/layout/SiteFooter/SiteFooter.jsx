import { Brand } from '../../ui/Brand/Brand.jsx'
import './SiteFooter.css'

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand-copy">
            <Brand />
            <p>Risk-free engineering capacity. Try developers before committing - we'll replace them until they're right.</p>
          </div>
          <div className="footer-cols">
            <div className="footer-col"><h5>Platform</h5><a href="#engine">How it works</a><a href="#stack">Technologies</a><a href="#why">Why Vedryx</a></div>
            <div className="footer-col"><h5>Company</h5><a href="#top">About</a><a href="#top">Careers</a><a href="#top">Security</a><a href="#top">Contact</a></div>
            <div className="footer-col"><h5>Get started</h5><a href="#submit">Request callback</a><a href="#submit">Contact Vedryx</a></div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Vedryx. All rights reserved.</span>
          <span>Developers employed by Vedryx - never your liability.</span>
        </div>
      </div>
    </footer>
  )
}
