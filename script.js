/* ============================================
   PELE AWAKENING — Site Interactions
   ============================================ */

(function () {
  'use strict';

  // ---- Scroll Animations (Intersection Observer) ----
  const animatedEls = document.querySelectorAll('[data-animate]');
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const delay = entry.target.dataset.delay || 0;
          setTimeout(() => entry.target.classList.add('visible'), +delay);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );
  animatedEls.forEach((el) => observer.observe(el));

  // ---- Navbar scroll effect ----
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });

  // ---- Mobile nav toggle ----
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    navToggle.classList.toggle('active');
  });
  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.classList.remove('active');
    });
  });

  // ---- Smooth scroll for in-page anchor links ----
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = nav.offsetHeight + 10;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // ---- Subtle parallax on the home hero (desktop only, home page only) ----
  const heroContent = document.querySelector('.hero-content');
  if (heroContent && window.matchMedia('(min-width: 769px)').matches) {
    const heroSection = document.querySelector('.hero');
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      const heroH = heroSection ? heroSection.offsetHeight : window.innerHeight;
      if (scrollY < heroH) {
        const ratio = scrollY / heroH;
        heroContent.style.transform = `translateY(${scrollY * 0.15}px)`;
        heroContent.style.opacity = 1 - ratio * 0.8;
      }
    }, { passive: true });
  }

  // ---- Crossfading photo loop ----
  document.querySelectorAll('.photo-loop').forEach((loop) => {
    const imgs = loop.querySelectorAll('img');
    if (imgs.length < 2) return;
    let idx = 0;
    setInterval(() => {
      imgs[idx].classList.remove('active');
      idx = (idx + 1) % imgs.length;
      imgs[idx].classList.add('active');
    }, 4000);
  });
})();
