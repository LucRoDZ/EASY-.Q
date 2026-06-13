/**
 * HomePage — landing page complète : hero, comment ça marche, pricing,
 * témoignages, footer.
 */

import {
  QrCode, Zap, BarChart3, Upload, Smartphone, ChefHat,
  Check, Star, ArrowRight,
} from 'lucide-react';
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

const STEPS = [
  {
    icon: Upload,
    step: '1',
    title: 'Uploadez votre carte PDF',
    desc: 'Notre IA lit votre menu et le structure automatiquement : sections, plats, prix, allergènes.',
  },
  {
    icon: Smartphone,
    step: '2',
    title: 'Vos QR codes sont générés',
    desc: 'Un QR code par table, prêt à imprimer. Vos clients scannent et découvrent le menu sur leur téléphone.',
  },
  {
    icon: ChefHat,
    step: '3',
    title: 'Recevez les commandes',
    desc: 'Commandes et paiements à table, écran cuisine temps réel, appels serveur — tout est connecté.',
  },
];

const FREE_FEATURES = [
  '1 menu digital',
  '10 tables avec QR codes',
  'Chatbot IA pour vos clients',
  'Menu multilingue (saisie manuelle)',
];

const PRO_FEATURES = [
  'Menus et tables illimités',
  'Paiement à table (Stripe)',
  'Écran cuisine (KDS) temps réel',
  'Analytics & rapports',
  'Traductions automatiques IA',
  'Réservations en ligne',
  'Split bill & pourboires',
  'Gestion du personnel',
  'Support prioritaire',
];

const TESTIMONIALS = [
  {
    name: 'Camille R.',
    restaurant: 'Le Petit Jardin — Lyon',
    stars: 5,
    quote:
      'Installé en une après-midi. Les clients commandent seuls, mes serveurs gagnent un temps fou en salle.',
  },
  {
    name: 'Karim B.',
    restaurant: 'Chez Karim — Marseille',
    stars: 5,
    quote:
      'Le paiement à table a changé nos services du midi : plus d’attente pour l’addition, tables libérées plus vite.',
  },
  {
    name: 'Sofia M.',
    restaurant: 'Trattoria Sofia — Paris 11e',
    stars: 4,
    quote:
      'L’OCR a lu ma carte italienne sans une faute. Les traductions automatiques sont un vrai plus pour les touristes.',
  },
];

function PricingCard({ name, price, sub, features, highlight, cta }) {
  return (
    <div
      className={`rounded-2xl border p-8 flex flex-col ${
        highlight
          ? 'border-neutral-900 bg-neutral-900 text-white shadow-xl'
          : 'border-neutral-200 bg-white'
      }`}
    >
      <h3 className={`text-sm font-semibold uppercase tracking-wide ${highlight ? 'text-neutral-400' : 'text-neutral-500'}`}>
        {name}
      </h3>
      <p className="mt-3">
        <span className="text-4xl font-bold">{price}</span>
        <span className={`text-sm ${highlight ? 'text-neutral-400' : 'text-neutral-500'}`}> {sub}</span>
      </p>
      <ul className="mt-6 space-y-2.5 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check size={15} className={`mt-0.5 shrink-0 ${highlight ? 'text-neutral-400' : 'text-neutral-500'}`} />
            <span className={highlight ? 'text-neutral-200' : 'text-neutral-700'}>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8">{cta}</div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-white flex flex-col">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">EasyQ</span>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-neutral-400">
            <a href="#how-it-works" className="hover:text-white transition-colors">Comment ça marche</a>
            <a href="#pricing" className="hover:text-white transition-colors">Tarifs</a>
          </nav>
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
        {/* ── Hero ── */}
        <section className="max-w-5xl mx-auto px-6 pt-24 pb-16 text-center">
          <h1 className="text-5xl font-bold text-neutral-900 leading-tight mb-5">
            Digitalisez votre menu<br />en 2 minutes
          </h1>
          <p className="text-xl text-neutral-500 mb-10 max-w-xl mx-auto">
            Uploadez votre PDF — notre IA crée un menu QR scannable, avec commande
            et paiement à table.
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
            <p className="text-xs text-neutral-400 mt-4">
              Gratuit pour toujours · Aucune carte bancaire requise
            </p>
          </SignedOut>

          <SignedIn>
            <AuthRedirect />
          </SignedIn>

          {/* Mockup menu QR */}
          <div className="mt-16 mx-auto max-w-xs" aria-hidden="true">
            <div className="bg-neutral-900 rounded-[2rem] p-3 shadow-2xl">
              <div className="bg-white rounded-3xl overflow-hidden text-left">
                <div className="bg-black text-white px-4 py-3">
                  <p className="text-sm font-semibold">Le Petit Jardin</p>
                  <p className="text-[10px] text-neutral-400">Table 12 · Menu</p>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    ['Burrata di Puglia', '12,50 €'],
                    ['Risotto aux cèpes', '19,00 €'],
                    ['Tiramisu maison', '8,00 €'],
                  ].map(([dish, price]) => (
                    <div key={dish} className="flex items-center justify-between border-b border-neutral-100 pb-2.5">
                      <span className="text-xs font-medium text-neutral-800">{dish}</span>
                      <span className="text-xs font-semibold text-neutral-900">{price}</span>
                    </div>
                  ))}
                  <div className="bg-black text-white text-center text-xs font-medium rounded-full py-2.5">
                    Commander · 39,50 €
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Feature cards ── */}
        <section className="max-w-5xl mx-auto px-6 pb-20">
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

        {/* ── Comment ça marche ── */}
        <section id="how-it-works" className="bg-neutral-50 border-y border-neutral-100">
          <div className="max-w-5xl mx-auto px-6 py-20">
            <h2 className="text-3xl font-bold text-neutral-900 text-center mb-12">
              Comment ça marche
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {STEPS.map(({ icon: Icon, step, title, desc }) => (
                <div key={step} className="text-center">
                  <div className="relative w-14 h-14 bg-black text-white rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Icon className="w-6 h-6" />
                    <span className="absolute -top-2 -right-2 w-6 h-6 bg-white border border-neutral-200 rounded-full text-xs font-bold text-neutral-900 flex items-center justify-center">
                      {step}
                    </span>
                  </div>
                  <h3 className="font-semibold text-neutral-900 mb-2">{title}</h3>
                  <p className="text-sm text-neutral-500 leading-relaxed max-w-xs mx-auto">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className="max-w-4xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-bold text-neutral-900 text-center mb-3">
            Un tarif simple et transparent
          </h2>
          <p className="text-neutral-500 text-center mb-12">
            Commencez gratuitement, passez en Pro quand votre activité décolle.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PricingCard
              name="Gratuit"
              price="0 €"
              sub="/ mois"
              features={FREE_FEATURES}
              cta={
                <SignedOut>
                  <SignUpButton mode="modal">
                    <button className="w-full border border-neutral-300 text-neutral-900 rounded-full py-3 font-medium hover:border-neutral-500 transition-colors">
                      Commencer
                    </button>
                  </SignUpButton>
                </SignedOut>
              }
            />
            <PricingCard
              name="Pro"
              price="49 €"
              sub="/ mois"
              highlight
              features={PRO_FEATURES}
              cta={
                <SignedOut>
                  <SignUpButton mode="modal">
                    <button className="w-full bg-white text-black rounded-full py-3 font-medium hover:bg-neutral-100 transition-colors flex items-center justify-center gap-2">
                      Essayer Pro
                      <ArrowRight size={15} />
                    </button>
                  </SignUpButton>
                </SignedOut>
              }
            />
          </div>
        </section>

        {/* ── Témoignages ── */}
        <section className="bg-neutral-50 border-y border-neutral-100">
          <div className="max-w-5xl mx-auto px-6 py-20">
            <h2 className="text-3xl font-bold text-neutral-900 text-center mb-12">
              Ils utilisent EasyQ
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {TESTIMONIALS.map(({ name, restaurant, stars, quote }) => (
                <div key={name} className="bg-white rounded-xl border border-neutral-200 p-6">
                  <div className="flex gap-0.5 mb-3" aria-label={`${stars} étoiles sur 5`}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        size={14}
                        className={i < stars ? 'text-amber-400 fill-amber-400' : 'text-neutral-200'}
                      />
                    ))}
                  </div>
                  <p className="text-sm text-neutral-600 leading-relaxed mb-4">« {quote} »</p>
                  <p className="text-sm font-semibold text-neutral-900">{name}</p>
                  <p className="text-xs text-neutral-400">{restaurant}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA final ── */}
        <section className="max-w-5xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-neutral-900 mb-4">
            Prêt à digitaliser votre restaurant ?
          </h2>
          <p className="text-neutral-500 mb-8">
            De l’upload du PDF au premier QR code scanné : 5 minutes, montre en main.
          </p>
          <SignedOut>
            <SignUpButton mode="modal">
              <button className="bg-black text-white px-8 py-3.5 rounded-full font-medium hover:bg-neutral-800 transition-colors">
                Créer mon menu gratuitement
              </button>
            </SignUpButton>
          </SignedOut>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="bg-neutral-950 text-neutral-400">
        <div className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
          <div>
            <p className="text-white font-semibold mb-3">EasyQ</p>
            <p className="text-xs leading-relaxed">
              Menus QR, commande et paiement à table pour les restaurants indépendants.
            </p>
          </div>
          <div>
            <p className="text-white font-semibold mb-3">Produit</p>
            <ul className="space-y-2 text-xs">
              <li><a href="#how-it-works" className="hover:text-white transition-colors">Comment ça marche</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">Tarifs</a></li>
            </ul>
          </div>
          <div>
            <p className="text-white font-semibold mb-3">Légal</p>
            <ul className="space-y-2 text-xs">
              <li><a href="/cgu" className="hover:text-white transition-colors">CGU</a></li>
              <li><a href="/confidentialite" className="hover:text-white transition-colors">Politique de confidentialité</a></li>
            </ul>
          </div>
          <div>
            <p className="text-white font-semibold mb-3">Contact</p>
            <ul className="space-y-2 text-xs">
              <li><a href="mailto:contact@easy-q.app" className="hover:text-white transition-colors">contact@easy-q.app</a></li>
              <li><a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Instagram</a></li>
              <li><a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">LinkedIn</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-neutral-800">
          <p className="max-w-5xl mx-auto px-6 py-5 text-center text-xs text-neutral-500">
            &copy; {new Date().getFullYear()} EasyQ. Tous droits réservés.
          </p>
        </div>
      </footer>
    </div>
  );
}
