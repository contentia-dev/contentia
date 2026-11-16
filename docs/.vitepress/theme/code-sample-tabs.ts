/**
 * On the API reference pages, picking a tab (Node.js or cURL) in one code group picks it in every
 * code group on the page, as on Stripe's. VitePress switches the clicked group itself; the others
 * are switched directly (radio + `active` block) rather than with synthetic clicks, which would
 * scroll each of them into view.
 */
function select(group: Element, title: string): void {
  const labels = Array.from(group.querySelectorAll<HTMLLabelElement>(':scope > .tabs > label'));
  const index = labels.findIndex(label => label.dataset.title === title);
  const input = group.querySelectorAll<HTMLInputElement>(':scope > .tabs > input')[index];
  const blocks = group.querySelector(':scope > .blocks');
  if (index < 0 || !input || !blocks) return;
  input.checked = true;
  Array.from(blocks.children).forEach((block, i) => block.classList.toggle('active', i === index));
}

/** Keep the code groups under `root` on the same tab. Returns the cleanup. */
export function syncCodeSampleTabs(root: Element): () => void {
  const onChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('.vp-code-group > .tabs > input')) return;
    const group = input.closest('.vp-code-group');
    const title = group?.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)?.dataset.title;
    if (!group || !title) return;
    root.querySelectorAll('.vp-code-group').forEach(other => {
      if (other !== group) select(other, title);
    });
  };
  root.addEventListener('change', onChange);
  return () => root.removeEventListener('change', onChange);
}
