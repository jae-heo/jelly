import { expect, type Page } from '@playwright/test';

// Exercise the actual selection + Send flow. Sending closes the panel.
export async function sendVirtualKey(page: Page, chord: string) {
  const open = page.getByRole('button', { name: 'Open shortcuts', exact: true });
  if (await open.isVisible()) await open.click();
  const panel = page.getByRole('region', { name: 'Virtual keyboard', exact: true });
  const reset = panel.getByRole('button', { name: 'Clear', exact: true });
  if (await reset.isEnabled()) await reset.click();
  const parts = chord.replace(/^(Ctrl|Shift|Alt) /, '$1+').split('+');
  const key = parts.pop()!;
  if (/^[a-z0-9]$/i.test(key)) await panel.getByRole('button', { name: 'Letters', exact: true }).click();
  else if (/^F\d+$/.test(key)) await panel.getByRole('button', { name: 'F1–F12', exact: true }).click();
  else if (!['Esc', 'Enter', 'Tab', 'Space', 'Backspace'].includes(key)) await panel.getByRole('button', { name: 'Navigate', exact: true }).click();
  for (const modifier of parts) await panel.getByRole('button', { name: modifier === 'Control' ? 'Ctrl' : modifier, exact: true }).click();
  await panel.getByRole('button', { name: key.length === 1 ? key.toUpperCase() : key, exact: true }).click();
  await panel.getByRole('button', { name: 'Send key combination', exact: true }).click();
  await expect(panel).toHaveCount(0);
}
