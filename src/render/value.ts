export function quoteOpenUiValue(value: string | number): string {
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: OpenUI statements stay one line
    .replace(/[\u0000-\u001f\u007f]/g, " ");
  return `"${escaped}"`;
}
