'use client';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';

export type GalleryImage = { src: string; alt: string; caption: string };

export function PhotoViewer({
  images,
  initialIndex,
  title,
  onClose,
}: {
  images: GalleryImage[];
  initialIndex: number;
  title: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = images[index];
  const move = (direction: number) => setIndex((current) => (current + direction + images.length) % images.length);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    setZoomed(false);
    setFailed(false);
    stage.current?.scrollTo(0, 0);
  }, [index]);

  useEffect(() => {
    if (!zoomed || !stage.current) return;
    const element = stage.current;
    element.scrollTo((element.scrollWidth - element.clientWidth) / 2, (element.scrollHeight - element.clientHeight) / 2);
  }, [zoomed]);

  return createPortal(
    <dialog
      ref={dialog}
      className="photo-viewer"
      aria-label={'Galeria — ' + title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClickCapture={(event) => {
        if (event.detail > 0 && performance.now() < suppressClickUntil.current) {
          suppressClickUntil.current = 0;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          move(event.key === 'ArrowRight' ? 1 : -1);
        }
      }}
    >
      <header className="photo-viewer-toolbar">
        <div className="photo-viewer-heading">
          <strong>{title}</strong>
          <span aria-live="polite">{index + 1} / {images.length}</span>
        </div>
        <div className="photo-viewer-actions">
          <button type="button" aria-label={zoomed ? 'Pomniejsz zdjęcie' : 'Powiększ zdjęcie'} aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)} disabled={failed}>
            {zoomed ? <ZoomOut /> : <ZoomIn />}
          </button>
          <button type="button" aria-label="Zamknij galerię" onClick={onClose} autoFocus><X /></button>
        </div>
      </header>
      <div
        ref={stage}
        className={'photo-viewer-stage' + (zoomed ? ' is-zoomed' : '')}
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
        onPointerDown={(event) => {
          if (event.isPrimary && event.pointerType !== 'mouse' && !zoomed) swipe.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => { swipe.current = null; }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || zoomed) return;
          const deltaX = event.clientX - start.x;
          const deltaY = event.clientY - start.y;
          if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
            suppressClickUntil.current = performance.now() + 400;
            move(deltaX < 0 ? 1 : -1);
          }
        }}
      >
        {failed ? <p role="status">Nie udało się wczytać tego zdjęcia. Wybierz następne.</p> : (
          <div className="photo-viewer-canvas" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <img key={active.src} src={active.src} alt={active.alt} draggable={false} onDoubleClick={() => setZoomed(!zoomed)} onError={() => setFailed(true)} />
          </div>
        )}
      </div>
      {images.length > 1 && <>
        <button type="button" className="photo-viewer-arrow previous" aria-label="Poprzednie zdjęcie" onClick={() => move(-1)}><ChevronLeft /></button>
        <button type="button" className="photo-viewer-arrow next" aria-label="Następne zdjęcie" onClick={() => move(1)}><ChevronRight /></button>
      </>}
      <footer className="photo-viewer-footer">
        <p aria-live="polite">{active.caption}</p>
        {images.length > 1 && <div className="photo-viewer-thumbnails" aria-label="Wybierz zdjęcie">
          {images.map((image, position) => <button key={image.src} type="button" aria-label={'Pokaż zdjęcie ' + (position + 1) + ': ' + image.alt} aria-current={position === index ? 'true' : undefined} onClick={() => setIndex(position)}>
            <img src={image.src} alt="" />
          </button>)}
        </div>}
      </footer>
    </dialog>,
    document.body,
  );
}
