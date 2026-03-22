/**
 * Update Checker
 * ==============
 * Checks GitHub releases for a newer version of Melon Synth.
 * Shows a gentle, dismissible notification — never modal, never blocking.
 *
 * Checks once on startup (after 8s delay) and once per day if left running.
 * Uses the GitHub API: GET /repos/{owner}/{repo}/releases/latest
 */

const REPO          = 'MilkmanAbi/Melon-Synth';
const CURRENT       = '1.0.0-alpha';
const CHECK_DELAY   = 8_000;      // ms after launch
const CHECK_INTERVAL = 86_400_000; // 24 hours

interface GithubRelease {
  tag_name:     string;  // e.g. "v1.1.0"
  name:         string;
  html_url:     string;
  body:         string;
  prerelease:   boolean;
  published_at: string;
}

// Simple semver comparison — returns true if b > a
function isNewer(current: string, latest: string): boolean {
  const clean = (v: string) => v.replace(/^v/, '').split('-')[0];
  const parts = (v: string) => clean(v).split('.').map(n => parseInt(n, 10) || 0);
  const [am, an, ap] = parts(current);
  const [bm, bn, bp] = parts(latest);
  if (bm !== am) return bm > am;
  if (bn !== an) return bn > an;
  return bp > ap;
}

export function startUpdateChecker(
  notify: (n: { type: string; title: string; body?: string; action?: { label: string; onClick: () => void } }) => void
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let dismissed = false;

  const check = async () => {
    if (dismissed) return;
    try {
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) }
      );
      if (!r.ok) return;
      const release: GithubRelease = await r.json();
      const latest = release.tag_name?.replace(/^v/, '') ?? '';
      if (!latest || !isNewer(CURRENT, latest)) return;

      const isAlpha = release.prerelease || latest.includes('alpha') || latest.includes('beta');
      const title   = `Melon Synth ${release.name ?? latest} is available`;
      const body    = release.body
        ? release.body.split('\n').slice(0, 3).join(' ').slice(0, 120) + '…'
        : 'A new version is available.';

      notify({
        type:   isAlpha ? 'info' : 'success',
        title,
        body,
        action: {
          label:   'View release',
          onClick: () => {
            dismissed = true;
            const url = release.html_url;
            if ((window as any).app?.openURL) (window as any).app.openURL(url);
            else window.open(url, '_blank');
          },
        },
      });
    } catch {
      // Network failure — fail silently
    }
  };

  const initialTimer = setTimeout(() => {
    check();
    timer = setInterval(check, CHECK_INTERVAL);
  }, CHECK_DELAY);

  return () => {
    clearTimeout(initialTimer);
    if (timer) clearInterval(timer);
  };
}
