import { Link } from 'react-router-dom'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '../components/ui/empty.jsx'

export function NotFoundPage() {
  return (
    <main className="relative flex min-h-svh w-full items-center justify-center overflow-hidden bg-[var(--bg)] px-4 py-16 text-[var(--text)] sm:px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(760px_420px_at_50%_20%,rgba(109,139,255,0.16),transparent_68%),radial-gradient(620px_360px_at_12%_82%,rgba(70,217,255,0.08),transparent_70%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(109,139,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(109,139,255,0.045)_1px,transparent_1px)] bg-[size:66px_66px] [mask-image:radial-gradient(circle_at_50%_32%,#000,transparent_78%)]"
      />

      <Empty>
        <EmptyHeader>
          <EmptyTitle className="mask-b-from-20% mask-b-to-80% font-[var(--font-display)] text-[clamp(92px,28vw,180px)] font-extrabold leading-none tracking-[-0.08em] text-white/12 [text-shadow:0_0_80px_rgba(109,139,255,0.32)]">
            404
          </EmptyTitle>
          <EmptyDescription className="-mt-3 max-w-[34ch] text-wrap-balance text-base leading-7 text-[var(--text)]/80 sm:-mt-5 sm:text-lg">
            The page you&apos;re looking for might have been moved or doesn&apos;t exist.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent style={{ marginTop: 'clamp(20px, 4%, 28px)' }}>
          <Link className="btn btn-primary w-full justify-center sm:w-auto" to="/">
            Return to Vedryx <span className="arrow">→</span>
          </Link>
        </EmptyContent>
      </Empty>
    </main>
  )
}
