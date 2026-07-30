export const DISCORD_EMBED_DESCRIPTION_BUDGET = 3900;

export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderPage(header, lines, separator) {
  return lines.length > 0 ? `${header}${separator}${lines.join('\n')}` : header;
}

export function paginateDiscordLines({
  firstHeader,
  continuationHeader,
  lines = [],
  maxLength = DISCORD_EMBED_DESCRIPTION_BUDGET,
  separator = '\n',
}) {
  const initialHeader = String(firstHeader || '').trim();
  const followUpHeader = String(continuationHeader || '').trim();
  const resultLines = lines.map((line) => String(line || '')).filter(Boolean);

  if (!initialHeader) {
    throw new Error('Discord pagination requires a first-page header.');
  }
  if (initialHeader.length > maxLength) {
    throw new Error(`Discord pagination header exceeds ${maxLength} characters.`);
  }

  const pages = [];
  let pageHeader = initialHeader;
  let pageLines = [];

  for (const line of resultLines) {
    const candidate = renderPage(pageHeader, [...pageLines, line], separator);
    if (candidate.length <= maxLength) {
      pageLines.push(line);
      continue;
    }

    if (pageLines.length === 0) {
      throw new Error(`Discord result line exceeds ${maxLength} characters.`);
    }

    pages.push(renderPage(pageHeader, pageLines, separator));
    pageHeader = followUpHeader;
    pageLines = [line];

    if (!pageHeader) {
      throw new Error('Discord pagination requires a continuation header.');
    }
    if (renderPage(pageHeader, pageLines, separator).length > maxLength) {
      throw new Error(`Discord result line exceeds ${maxLength} characters.`);
    }
  }

  pages.push(renderPage(pageHeader, pageLines, separator));
  return pages;
}
