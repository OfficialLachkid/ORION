const PANORAMA_TOP_BAR_SOLID_THRESHOLD_PX = 24;
const PANORAMA_TOP_BAR_SCROLL_OFFSET_PX = 18;

function prefersReducedMotion() {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function setupScrollReveal(root, scrollContainer = null) {
  const revealTargets = Array.from(root.querySelectorAll('[data-scroll-reveal]'));
  if (revealTargets.length < 1) {
    return () => {};
  }

  if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
    revealTargets.forEach((target) => {
      target.classList.add('scroll-reveal-visible');
    });
    return () => {};
  }

  revealTargets.forEach((target) => {
    target.classList.remove('scroll-reveal-visible');
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add('scroll-reveal-visible');
        observer.unobserve(entry.target);
      });
    },
    {
      root: scrollContainer,
      threshold: 0.08,
      rootMargin: '0px 0px 6% 0px',
    }
  );

  revealTargets.forEach((target) => {
    observer.observe(target);
  });

  return () => observer.disconnect();
}

export function setupPanoramaTopBarState(root, scrollContainer = null) {
  const topBar = root.querySelector('.panorama-top-bar-shell');
  if (!topBar) {
    return () => {};
  }

  const update = () => {
    const nextIsSolid = scrollContainer
      ? scrollContainer.scrollTop > PANORAMA_TOP_BAR_SOLID_THRESHOLD_PX
      : globalThis.scrollY > PANORAMA_TOP_BAR_SOLID_THRESHOLD_PX;

    topBar.classList.toggle('panorama-top-bar-shell-solid', nextIsSolid);
    topBar.classList.toggle('panorama-top-bar-shell-transparent', !nextIsSolid);
  };

  const source = scrollContainer || globalThis;
  source.addEventListener('scroll', update, { passive: true });
  globalThis.addEventListener('resize', update);
  update();

  return () => {
    source.removeEventListener('scroll', update);
    globalThis.removeEventListener('resize', update);
  };
}

export function setupStandalonePreviewNavigation(root, scrollContainer = null) {
  const anchors = Array.from(root.querySelectorAll('[data-nav-anchor]'));
  if (anchors.length < 1) {
    return () => {};
  }

  const listeners = anchors.map((anchor) => {
    const handleClick = (event) => {
      const previewAnchorId = anchor.dataset.navAnchor || '';
      const sectionNode = root.querySelector(`#${CSS.escape(previewAnchorId)}`);
      if (!sectionNode) {
        return;
      }

      event.preventDefault();
      const topBar = root.querySelector('.panorama-top-bar-shell');
      const topBarHeight = topBar?.getBoundingClientRect().height || 0;
      const behavior = prefersReducedMotion() ? 'auto' : 'smooth';

      if (scrollContainer) {
        const frameRect = scrollContainer.getBoundingClientRect();
        const targetRect = sectionNode.getBoundingClientRect();
        const top =
          scrollContainer.scrollTop +
          (targetRect.top - frameRect.top) -
          topBarHeight -
          PANORAMA_TOP_BAR_SCROLL_OFFSET_PX;

        scrollContainer.scrollTo({
          top: Math.max(0, top),
          behavior,
        });
        return;
      }

      const top =
        sectionNode.getBoundingClientRect().top +
        globalThis.scrollY -
        topBarHeight -
        PANORAMA_TOP_BAR_SCROLL_OFFSET_PX;

      globalThis.history?.replaceState?.(globalThis.history.state, '', `#${previewAnchorId}`);
      globalThis.scrollTo({
        top: Math.max(0, top),
        behavior,
      });
    };

    anchor.addEventListener('click', handleClick);
    return { anchor, handleClick };
  });

  return () => {
    listeners.forEach(({ anchor, handleClick }) => {
      anchor.removeEventListener('click', handleClick);
    });
  };
}
