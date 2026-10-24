/**
 * Copies text to the clipboard. Falls back to a hidden field and the copy
 * command where the async clipboard isn't allowed. Resolves with whether it
 * worked. Call it straight from a click or key press: browsers only allow
 * copying then.
 */
export function copyText(text: string): Promise<boolean> {
  const fallback = () => {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  };
  if (!navigator.clipboard?.writeText) return Promise.resolve(fallback());
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => fallback(),
  );
}
