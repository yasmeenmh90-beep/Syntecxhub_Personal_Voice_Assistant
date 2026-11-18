import { useEffect, useRef, type RefObject } from "react";

/** Trap focus while present and restore it when a modal starts to exit. */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  close: () => void,
  present = true,
) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);
  useEffect(() => {
    if (!present) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const elements = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex='0']",
        ) ?? [],
      ).filter((el) => !el.closest("[hidden]"));
    (
      root?.querySelector<HTMLElement>("[data-autofocus]") ??
      elements()[0] ??
      root
    )?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = elements();
      if (!items.length) {
        event.preventDefault();
        root?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === items[0] ||
          !root?.contains(document.activeElement))
      ) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === items.at(-1) ||
          !root?.contains(document.activeElement))
      ) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [ref, present]);
}
