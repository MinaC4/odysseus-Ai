export function eventTarget(event: Event | { target: EventTarget | null; nativeEvent: Event }): EventTarget | null {
  const native='nativeEvent' in event ? event.nativeEvent : event;
  return native.composedPath()[0] ?? event.target;
}
export function activeElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}
