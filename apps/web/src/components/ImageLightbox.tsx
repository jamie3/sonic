import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface LightboxImage {
  src: string;
  /** Caption and alt text, e.g. "Front" or "Discogs cover". */
  label: string;
}

/**
 * Full-screen image viewer: one image at a time, scaled to fit, with previous /
 * next (buttons, ← → keys, swipe), a counter, and a thumbnail strip. Closes on
 * Esc, the × button, or a click on the backdrop. Built on Radix Dialog, so
 * focus is trapped while open and returns to the clicked thumbnail on close.
 */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  title,
}: {
  images: LightboxImage[];
  /** Image shown; null = closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Read by screen readers as the dialog's name. */
  title: string;
}) {
  const open = index !== null && images.length > 0;
  const current = open ? Math.min(index, images.length - 1) : 0;
  const many = images.length > 1;

  const go = useCallback(
    (delta: number) => onIndexChange((current + delta + images.length) % images.length),
    [current, images.length, onIndexChange],
  );

  useEffect(() => {
    if (!open || !many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, many, go]);

  // Swipe left/right on touch screens.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchX.current;
    touchX.current = null;
    const end = e.changedTouches[0]?.clientX;
    if (start == null || end == null || !many) return;
    if (Math.abs(end - start) > 50) go(end < start ? 1 : -1);
  };

  // Keep the active thumbnail in view.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
  }, [current]);

  const image = images[current];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-none"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>

          {/* Top bar: caption + counter, close. */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 text-white">
            <p className="min-w-0 truncate text-sm">
              <span className="font-medium">{image?.label}</span>
              {many && (
                <span className="ml-2 font-mono text-xs tabular-nums text-white/60">
                  {current + 1} / {images.length}
                </span>
              )}
            </p>
            <DialogPrimitive.Close
              className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Image; a click on the empty area around it closes. */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-16"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            {image && (
              <img
                key={image.src}
                src={image.src}
                alt={image.label}
                className="max-h-full max-w-full select-none rounded-sm object-contain shadow-2xl animate-in fade-in-0"
                draggable={false}
              />
            )}
            {many && (
              <>
                <NavButton side="left" onClick={() => go(-1)} />
                <NavButton side="right" onClick={() => go(1)} />
              </>
            )}
          </div>

          {/* Thumbnail strip. */}
          {many && (
            <div ref={stripRef} className="flex justify-center gap-2 overflow-x-auto px-4 py-3">
              {images.map((img, i) => (
                <button
                  key={img.src}
                  type="button"
                  data-index={i}
                  onClick={() => onIndexChange(i)}
                  aria-label={`Show ${img.label}`}
                  aria-current={i === current}
                  className={cn(
                    "size-14 shrink-0 overflow-hidden rounded-md border-2 transition-opacity focus-visible:outline-2 focus-visible:outline-white",
                    i === current ? "border-white opacity-100" : "border-transparent opacity-50 hover:opacity-90",
                  )}
                >
                  <img src={img.src} alt="" className="h-full w-full object-cover" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous image" : "Next image"}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:bg-black/60 hover:text-white focus-visible:outline-2 focus-visible:outline-white",
        side === "left" ? "left-2 sm:left-4" : "right-2 sm:right-4",
      )}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}
