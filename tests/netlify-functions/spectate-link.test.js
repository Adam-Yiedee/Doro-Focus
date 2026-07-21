import { describe, expect, it } from 'vitest';

const spectateLinkHandler = (await import('../../netlify/functions/spectate-link.js')).default;

const renderPreview = async (url) => {
  const response = await spectateLinkHandler(new Request(url));
  return {
    response,
    html: await response.text(),
  };
};

describe('spectate-link function', () => {
  it('places the shared estimated end time in social preview metadata', async () => {
    const { response, html } = await renderPreview(
      'https://dorofocus.netlify.app/share/MWRE7L?mode=work&end=1784666280000&endLabel=1%3A38%20PM&remaining=1380&tzOffset=420',
    );

    expect(response.status).toBe(200);
    expect(html).toContain('<meta property="og:title" content="Focus Ends At 1:38 PM">');
    expect(html).toContain('<meta name="twitter:title" content="Focus Ends At 1:38 PM">');
    expect(html).toContain('<meta property="og:image:alt" content="Focus Ends At 1:38 PM">');
    expect(html).toContain('endLabel=1%3A38+PM');
    expect(html).not.toContain('Focus until');
  });

  it('rebuilds the local end label from timestamp and timezone offset when the label is missing', async () => {
    const endMs = Date.UTC(2026, 6, 21, 20, 38);
    const { html } = await renderPreview(
      `https://dorofocus.netlify.app/.netlify/functions/spectate-link?session=MWRE7L&mode=work&end=${endMs}&remaining=1380&tzOffset=420`,
    );

    expect(html).toContain('<meta property="og:title" content="Focus Ends At 1:38 PM">');
    expect(html).toContain('Estimated end: 1:38 PM.');
    expect(html).toContain('endLabel=1%3A38+PM');
  });

  it('does not present placeholder labels as estimated end times', async () => {
    const { html } = await renderPreview(
      'https://dorofocus.netlify.app/share/MWRE7L?mode=break&endLabel=Not%20running',
    );

    expect(html).toContain('<meta property="og:title" content="Doro Shared Timer">');
    expect(html).not.toContain('Break Ends At Not running');
  });
});
