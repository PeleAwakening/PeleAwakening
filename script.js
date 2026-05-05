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
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    nav.classList.toggle('scrolled', scrollY > 60);
    lastScroll = scrollY;
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

  // ---- Fire particles (hero) ----
  const particleContainer = document.getElementById('particles');
  function createParticle() {
    const particle = document.createElement('div');
    particle.classList.add('particle');
    const x = Math.random() * 100;
    const size = Math.random() * 3 + 1;
    const duration = Math.random() * 6 + 4;
    const hue = Math.random() * 30; // 0-30 range around orange
    particle.style.cssText = `
      left: ${x}%;
      bottom: 0;
      width: ${size}px;
      height: ${size}px;
      background: hsl(${15 + hue}, 90%, ${55 + Math.random() * 20}%);
      animation-duration: ${duration}s;
      animation-delay: ${Math.random() * 2}s;
    `;
    particleContainer.appendChild(particle);
    setTimeout(() => particle.remove(), (duration + 2) * 1000);
  }
  // Spawn particles periodically
  setInterval(createParticle, 400);

  // ---- Smooth scroll for anchor links ----
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

  // ---- Parallax on hero elements (subtle, desktop only) ----
  if (window.matchMedia('(min-width: 769px)').matches) {
    const heroContent = document.querySelector('.hero-content');
    const heroEmblem = document.querySelector('.hero-emblem');
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      const heroH = window.innerHeight;
      if (scrollY < heroH) {
        const ratio = scrollY / heroH;
        heroContent.style.transform = `translateY(${scrollY * 0.15}px)`;
        heroContent.style.opacity = 1 - ratio * 0.8;
      }
    }, { passive: true });
  }
})();
