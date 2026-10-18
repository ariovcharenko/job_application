/** Sets a text field's value the way a person typing would, so React-controlled forms (Greenhouse,
 * Ashby, Workday) notice it: React tracks `value` with its own property on the element, so a plain
 * `el.value = x` looks like "no change" to it. The prototype's native setter bypasses that
 * tracker, and the bubbling input/change events then make React read the new value. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
