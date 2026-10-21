// Email templates (P12-01): one function per email, each returning
// { subject, text, html }. A shared layout keeps them alike: the server's
// name, the message, at most one button-style link and a footer. Inline CSS,
// no images or tracking, every value escaped.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// { serverName, publicUrl, heading, paragraphs: [string], button: { label, url } | null, footer }
function layout({ serverName, publicUrl, heading, paragraphs, button = null, footer }) {
  const host = publicUrl ? publicUrl.replace(/^https?:\/\//, '') : '';
  const foot = footer || `You’re getting this because you have an account on ${serverName}${host ? ` (${host})` : ''}.`;
  const text = [
    heading,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []),
    '—',
    foot,
  ].join('\n');
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f2f7;font-family:Arial,Helvetica,sans-serif;color:#1d1a24">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px">
<tr><td style="padding:28px 32px">
<p style="margin:0 0 4px;font-size:13px;color:#6b6478">${esc(serverName)}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5">${esc(p)}</p>`).join('\n')}
${button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#6d3fd1;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px">${esc(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#6b6478">Or paste this into your browser: ${esc(button.url)}</p>` : ''}
<hr style="border:none;border-top:1px solid #e6e2ee;margin:20px 0">
<p style="margin:0;font-size:12px;color:#6b6478">${esc(foot)}</p>
</td></tr></table>
</body></html>`;
  return { text, html };
}

// The admin page's "Send test email".
function testEmail({ serverName, publicUrl, by }) {
  const { text, html } = layout({
    serverName,
    publicUrl,
    heading: 'Email works',
    paragraphs: [
      `This is a test email from ${serverName}, sent by ${by} from Settings › Site admin › Email.`,
      'If it landed in spam, mark it as not spam, and check the domain’s SPF, DKIM and DMARC records.',
    ],
    button: publicUrl ? { label: `Open ${serverName}`, url: publicUrl } : null,
    footer: `You’re getting this because a site admin of ${serverName} sent a test to this address.`,
  });
  return { subject: `Test email from ${serverName}`, text, html };
}

// P12-02: "Confirm your email", sent when an address is added or changed.
function confirmEmail({ serverName, publicUrl, username, link }) {
  const { text, html } = layout({
    serverName,
    publicUrl,
    heading: 'Confirm your email',
    paragraphs: [
      `Hi ${username}, please confirm this is your email address for ${serverName}. It’s used to reset your password if you forget it.`,
      'The link works once and expires in 24 hours.',
      `If you didn’t ask for this, you can ignore this email: nothing changes until the link is used.`,
    ],
    button: { label: 'Confirm my email', url: link },
  });
  return { subject: `Confirm your email for ${serverName}`, text, html };
}

module.exports = { layout, testEmail, confirmEmail, esc };
