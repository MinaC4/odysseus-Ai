export function eventTarget(event: Event | { target: EventTarget | null; nativeEvent: Event }): EventTarget | null {
  const native='nativeEvent' in event ? event.nativeEvent : event;
  return native.composedPath()[0] ?? event.target;
}
export function isWorkspaceShortcutBlocked(event: Event): boolean {
  const target = eventTarget(event);
  return target instanceof Element && (
    (target instanceof HTMLElement && target.isContentEditable)
    || !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"]')
  );
}
export function activeElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}
