// FBV FleetOS — /login (design/login.md).
// Split-screen, GSAP hero. The SignInForm is a self-contained component:
// the backend phase rewires it to real auth (Kimi OAuth + username/password)
// without touching this layout.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(useGSAP);

const QUOTES = [
  'Nairobi → Mombasa, 6 vehicles on the corridor right now.',
  'KDJ 123A arrived at Mombasa Port 12 min ago.',
  'Service due: KDK 208C in 480 km.',
];

const ROLES: { role: string; desc: string; email: string }[] = [
  { role: 'Admin', desc: 'Full control & audit', email: 'admin@fbv.co.ke' },
  { role: 'Fleet Manager', desc: 'Vehicles, fuel & costs', email: 'fleet@fbv.co.ke' },
  { role: 'Dispatcher', desc: 'Jobs & live map', email: 'dispatch@fbv.co.ke' },
  { role: 'Mechanic', desc: 'Work orders & parts', email: 'mechanic@fbv.co.ke' },
  { role: 'Driver', desc: 'Mobile DVIR & jobs', email: 'driver@fbv.co.ke' },
  { role: 'Read-only', desc: 'Reports & analytics', email: 'readonly@fbv.co.ke' },
];

/* ------------------------------------------------------------------ */
/* Self-contained sign-in form — backend phase rewires this component  */
/* ------------------------------------------------------------------ */

export function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('admin@fbv.co.ke');
  const [password, setPassword] = useState('demo1234');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TODO(backend): replace with real auth (Kimi OAuth + username/password).
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      if (!email.includes('@') || password.length < 4) {
        setError('Invalid credentials — try a demo login below.');
        return;
      }
      onSuccess();
    }, 650);
  };

  return (
    <form onSubmit={submit} className="login-card flex flex-col gap-3.5 rounded-drawer border border-navy-700 bg-navy-800 p-6">
      {error && (
        <div className="rounded-lg bg-alert-soft px-3 py-2 text-[13px] font-medium text-alert-on-soft">{error}</div>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-navy-100/70">Work email</span>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@fbv.co.ke" autoComplete="username"
          className="h-11 rounded-lg border border-navy-700 bg-navy-900 px-3 text-[14px] text-white outline-none transition-colors placeholder:text-navy-100/40 focus:border-accent-on-navy focus:ring-2 focus:ring-accent-on-navy/30"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-navy-100/70">Password</span>
        <span className="relative">
          <input
            type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="h-11 w-full rounded-lg border border-navy-700 bg-navy-900 px-3 pr-10 text-[14px] text-white outline-none transition-colors focus:border-accent-on-navy focus:ring-2 focus:ring-accent-on-navy/30"
          />
          <button type="button" onClick={() => setShowPw(!showPw)} aria-label="Toggle password"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-navy-100/60 hover:text-white">
            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      </label>
      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy-100">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#22D3EE]" />
          Remember me
        </label>
        <button type="button" className="text-[13px] font-medium text-accent-on-navy hover:underline">Forgot password?</button>
      </div>
      <button type="submit" disabled={loading}
        className="flex h-11 items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-semibold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97] disabled:opacity-70">
        {loading ? (<><Loader2 size={16} className="animate-spin" /> Authenticating…</>) : 'Sign in →'}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */

export default function Login() {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const headlineWords = 'Run your entire fleet from one screen.'.split(' ');

  useGSAP(() => {
    if (reduced || !root.current) return;
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.fromTo('.login-hero-img', { scale: 1.08 }, { scale: 1, duration: 1.2 }, 0)
      .fromTo('.login-scrim', { opacity: 0 }, { opacity: 1, duration: 0.9 }, 0)
      .fromTo('.login-brand', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.1)
      .fromTo('.login-word', { yPercent: 110 }, { yPercent: 0, duration: 0.6, stagger: 0.04, ease: 'power3.out' }, 0.2)
      .fromTo('.login-sub', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45 }, 0.5)
      .fromTo('.login-card', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.55)
      .fromTo('.login-role', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.05 }, 0.7)
      .fromTo('.login-ticker', { x: 24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5 }, 0.75)
      .fromTo('.login-micro', { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.9);
  }, { scope: root });

  useEffect(() => {
    const t = setInterval(() => setQuoteIdx((i) => (i + 1) % QUOTES.length), 5000);
    return () => clearInterval(t);
  }, []);

  const handleSuccess = () => {
    setLeaving(true);
    setTimeout(() => navigate('/'), reduced ? 0 : 300);
  };

  return (
    <div ref={root} className="flex min-h-[100dvh] flex-col bg-navy-900 lg:flex-row">
      {/* left panel — brand + form */}
      <div className={cn(
        'flex flex-1 flex-col justify-center px-6 py-10 transition-all duration-300 sm:px-12 lg:w-[44%] lg:flex-none lg:px-[4.5%]',
        leaving && 'scale-[0.98] opacity-0',
      )}>
        <div className="mx-auto w-full max-w-[420px]">
          <div className="login-brand mb-8 flex items-center gap-3">
            <img src="/logo.svg" alt="FleetOS" className="h-11 w-11" />
            <div>
              <div className="text-[22px] font-extrabold leading-7 text-white">FBV FleetOS</div>
              <div className="text-[13px] text-navy-100">Fleet operations · Safety · Compliance</div>
            </div>
          </div>

          <h1 className="mb-3 text-[30px] font-extrabold leading-[38px] tracking-[-0.02em] text-white sm:text-[34px] sm:leading-[40px]">
            {headlineWords.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden pb-0.5 align-bottom">
                <span className="login-word inline-block">{w}{i < headlineWords.length - 1 ? ' ' : ''}</span>
              </span>
            ))}
          </h1>
          <p className="login-sub mb-7 text-[15px] leading-6 text-navy-100">
            Live GPS, driver safety, compliance, maintenance and fuel — built for Kenyan roads.
          </p>

          <SignInForm onSuccess={handleSuccess} />

          <div className="mt-6">
            <div className="login-micro mb-2.5 text-[12px] font-medium uppercase tracking-[0.06em] text-navy-100/60">
              Explore the demo — sign in as
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ROLES.map((r) => (
                <button key={r.role} type="button"
                  onClick={() => {
                    // role quick-login: auto-fill + instant submit (demo)
                    handleSuccess();
                  }}
                  className="login-role rounded-[10px] border border-navy-700 bg-navy-800 px-3 py-2.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-accent-on-navy">
                  <div className="text-[13px] font-semibold text-white">{r.role}</div>
                  <div className="text-[11px] leading-4 text-navy-100/70">{r.desc}</div>
                </button>
              ))}
            </div>
            <div className="login-micro mt-3 text-[11px] text-navy-100/60">Demo data resets on demand · All times EAT</div>
          </div>

          <p className="login-micro mt-6 text-[11px] leading-4 text-navy-100/70">
            By signing in you agree to FBV's acceptable-use policy. All activity is recorded in the audit trail.
          </p>
        </div>
      </div>

      {/* right panel — hero */}
      <div className="relative order-first h-[180px] overflow-hidden lg:order-none lg:h-auto lg:flex-1">
        <img src="/login-hero.jpg" alt="FBV fleet yard at dusk"
          className="login-hero-img absolute inset-0 h-full w-full object-cover" />
        <div className="login-scrim absolute inset-0 bg-gradient-to-r from-navy-950/85 via-navy-950/45 to-navy-950/15" />
        <img src="/login-texture.svg" alt=""
          className={cn('absolute -inset-10 h-[calc(100%+80px)] w-[calc(100%+80px)] object-cover opacity-40', !reduced && 'animate-texture-drift')} />

        {/* live-stats ticker card */}
        <div className="login-ticker absolute bottom-10 left-6 hidden lg:left-10 lg:block">
          <div className="glass-navy w-[380px] rounded-xl border border-navy-700 p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute h-full w-full rounded-full bg-accent-on-navy animate-pulse-live-ring" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-accent-on-navy" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-navy-100">Live simulation</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['14', 'vehicles tracked'],
                ['38,204', 'km this month'],
                ['94.2', 'avg safety score'],
              ].map(([v, l]) => (
                <div key={l}>
                  <div className="font-mono text-[18px] font-bold leading-6 text-white">{v}</div>
                  <div className="text-[11px] text-navy-100/80">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 h-5 overflow-hidden border-t border-navy-700/70 pt-2">
              <div key={quoteIdx} className="animate-[quote-in_0.4s_ease-out] text-[12px] italic text-navy-100/90">
                “{QUOTES[quoteIdx]}”
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* footer strip across both panels */}
      <footer className="glass-navy fixed inset-x-0 bottom-0 z-10 flex h-8 items-center justify-between px-4 text-[11px] text-navy-100/80">
        <span>FBV FleetOS · Demo build · Nairobi, Kenya · EAT (UTC+3)</span>
        <span className="font-mono">v2.4.1</span>
      </footer>
    </div>
  );
}
