import { useEffect } from 'react'

export function usePageMotion() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nav = document.querySelector('.nav')
    const reveals = [...document.querySelectorAll('[data-reveal]')]
    const timers = new Set()
    let navFrame = 0

    function scrollToHash(behavior = 'smooth') {
      if (!window.location.hash) return
      const target = document.querySelector(window.location.hash)
      target?.scrollIntoView({ block: 'start', behavior })
    }

    function onHashChange() {
      window.requestAnimationFrame(() => scrollToHash(reduced ? 'auto' : 'smooth'))
    }

    function onScrollNav() {
      if (navFrame) return
      navFrame = window.requestAnimationFrame(() => {
        navFrame = 0
        nav?.classList.toggle('scrolled', window.scrollY > 24)
      })
    }

    function revealElement(el) {
      const delay = Math.min(Number.parseFloat(el.dataset.delay || 0) * 1000, 160)
      const timer = window.setTimeout(() => {
        el.classList.add('reveal-in')
        timers.delete(timer)
      }, reduced ? 0 : delay)
      timers.add(timer)
    }

    function markAllRevealed() {
      reveals.forEach((el) => el.classList.add('reveal-in'))
    }

    function setNavImmediately() {
      nav?.classList.toggle('scrolled', window.scrollY > 24)
    }

    const hashTimer = window.setTimeout(() => scrollToHash(reduced ? 'auto' : 'smooth'), 80)
    timers.add(hashTimer)
    window.addEventListener('hashchange', onHashChange)

    if (reduced) {
      markAllRevealed()
      document.body.classList.add('hero-done')
      setNavImmediately()
      window.addEventListener('scroll', onScrollNav, { passive: true })

      return () => {
        window.clearTimeout(hashTimer)
        timers.delete(hashTimer)
        if (navFrame) window.cancelAnimationFrame(navFrame)
        document.body.classList.remove('hero-done')
        window.removeEventListener('scroll', onScrollNav)
        window.removeEventListener('hashchange', onHashChange)
      }
    }

    document.body.classList.add('anim')
    const heroTimer = window.setTimeout(() => document.body.classList.add('hero-done'), 2200)
    setNavImmediately()

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        revealElement(entry.target)
        observer.unobserve(entry.target)
      })
    }, {
      root: null,
      rootMargin: '0px 0px -10% 0px',
      threshold: 0.1,
    })

    reveals.forEach((el) => observer.observe(el))

    window.addEventListener('scroll', onScrollNav, { passive: true })

    return () => {
      window.clearTimeout(heroTimer)
      window.clearTimeout(hashTimer)
      if (navFrame) window.cancelAnimationFrame(navFrame)
      timers.forEach((timer) => window.clearTimeout(timer))
      observer.disconnect()
      document.body.classList.remove('anim', 'hero-done')
      window.removeEventListener('scroll', onScrollNav)
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])
}
