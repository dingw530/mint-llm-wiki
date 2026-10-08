import { useState, useCallback, useRef, useEffect } from 'react';

const STORAGE_KEY = 'mint-sidebar-width';
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

/**
 * Hook for resizable sidebar with drag handle.
 * Persists width to localStorage.
 */
export function useSidebarResize() {
  const [width, setWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const n = Number(stored);
        if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
      }
    } catch { /* ignore */ }
    return DEFAULT_WIDTH;
  });

  // Persist to localStorage on width change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch { /* ignore */ }
  }, [width]);

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setWidth(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return { width, onMouseDown } as const;
}
