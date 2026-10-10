/** Keyboard shortcuts must leave editing controls to handle their own keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !('tagName' in target)) return false;
  const element = target as HTMLElement;
  return element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}
