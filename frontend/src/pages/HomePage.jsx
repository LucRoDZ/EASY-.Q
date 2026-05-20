import { QrCode, Zap, BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SignUpButton, SignInButton, SignedIn, SignedOut } from '@clerk/clerk-react';
import AuthRedirect from '../components/AuthRedirect';

const FEATURES = [
  {
    icon: QrCode,
    title: 'Menu QR interactif',
    desc: 'Vos clients scannent, naviguent, commandent — sans app ni friction.',
  },
  {
    icon: Zap,
    title: 'OCR IA automatique',
    desc: 'Uploadez votre PDF et notre IA structure votre menu en quelques secondes.',
  },
  {
    icon: BarChart3,
    title: 'Analytics en temps réel',
    desc: 'Suivez les plats populaires, les heures de pointe et le chiffre d\'affaires.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-white flex flex-col">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">EasyQ</span>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="text-sm text-neutral-300 hover:text-white transition-colors">
                Se connecter
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link to="/dashboard" className="text-sm text-neutral-300 hover:text-white transition-colors">
              Tableau de bord
            </Link>
          </SignedIn>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
          <h1 className="text-5xl font-bold text-neutral-900 leading-tight mb-5">
            Digitalisez votre menu<br />en 2 minutes
          </h1>
          <p className="text-xl text-neutral-500 mb-10 max-w-xl mx-auto">
            Uploadez votre PDF — notre IA crée un menu QR scannable instantanément.
          </p>

          <SignedOut>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <SignUpButton mode="modal">
                <button className="bg-black text-white px-8 py-3 rounded-full font-medium hover:bg-neutral-800 transition-colors">
                  Commencer gratuitement
                </button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button className="text-neutral-600 hover:text-neutral-900 font-medium transition-colors">
                  Se connecter
                </button>
              </SignInButton>
            </div>
          </SignedOut>

          <SignedIn>
            <AuthRedirect />
          </SignedIn>
        </section>

        {/* Feature cards */}
        <section className="max-w-5xl mx-auto px-6 pb-24">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6"
              >
                <div className="w-10 h-10 bg-neutral-100 rounded-lg flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-neutral-700" />
                </div>
                <h3 className="font-semibold text-neutral-900 mb-2">{title}</h3>
                <p className="text-sm text-neutral-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-100 py-6">
        <p className="text-center text-sm text-neutral-400">
          &copy; {new Date().getFullYear()} EasyQ. Tous droits réservés.
        </p>
      </footer>
    </div>
  );
}
