import { describe, expect, it } from 'vitest';

const spectateLinkHandler = (await import('../../netlify/functions/spectate-link.js')).default;
const spectateOgHandler = (await import('../../netlify/functions/spectate-og.js')).default;

const renderPreview = async (url) => {
  const response = await spectateLinkHandler(new Request(url));
  return {
    response,
    html: await response.text(),
  };
};

describe('spectate-link function', () => {
  it('places the shared time finished value in social preview metadata', async () => {
    const { response, html } = await renderPreview(
      'https://dorofocus.netlify.app/share/MWRE7L?mode=work&end=1784666280000&endLabel=1%3A38%20PM&remaining=1380&tzOffset=420',
    );

    expect(response.status).toBe(200);
    expect(html).toContain('<meta property="og:title" content="Time Finished: 1:38 PM">');
    expect(html).toContain('<meta name="twitter:title" content="Time Finished: 1:38 PM">');
    expect(html).toContain('<meta property="og:image:alt" content="Time Finished: 1:38 PM">');
    expect(html).toContain('endLabel=1%3A38+PM');
    expect(html).toContain('v=4');
    expect(html).toContain('preview=4');
    expect(html).not.toContain('Focus until');
  });

  it('rebuilds the local end label from timestamp and timezone offset when the label is missing', async () => {
    const endMs = Date.UTC(2026, 6, 21, 20, 38);
    const { html } = await renderPreview(
      `https://dorofocus.netlify.app/.netlify/functions/spectate-link?session=MWRE7L&mode=work&end=${endMs}&remaining=1380&tzOffset=420`,
    );

    expect(html).toContain('<meta property="og:title" content="Time Finished: 1:38 PM">');
    expect(html).toContain('Shared Doro timer.');
    expect(html).toContain('endLabel=1%3A38+PM');
  });

  it('keeps projected finish links focused on the predicted end time', async () => {
    const { html } = await renderPreview(
      'https://dorofocus.netlify.app/share/MWRE7L?mode=break&endKind=finish&end=1784666280000&endLabel=1%3A38%20PM&remaining=7200&tzOffset=420',
    );

    expect(html).toContain('<meta property="og:title" content="Time Finished: 1:38 PM">');
    expect(html).toContain('<meta name="twitter:title" content="Time Finished: 1:38 PM">');
    expect(html).toContain('Shared Doro timer.');
    expect(html).toContain('endKind=finish');
    expect(html).not.toContain('Break Ends At 1:38 PM');
  });

  it('does not present placeholder labels as estimated end times', async () => {
    const { html } = await renderPreview(
      'https://dorofocus.netlify.app/share/MWRE7L?mode=break&endLabel=Not%20running',
    );

    expect(html).toContain('<meta property="og:title" content="Doro Timer">');
    expect(html).not.toContain('Break Ends At Not running');
  });

  it('renders a real png social image with only the predicted end time contract', async () => {
    const response = await spectateOgHandler(new Request(
      'https://dorofocus.netlify.app/.netlify/functions/spectate-og?session=MWRE7L&mode=work&endKind=finish&end=1784666280000&endLabel=1%3A38%20PM&remaining=7200&tzOffset=420',
    ));
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.length).toBeGreaterThan(10000);
  });
});
