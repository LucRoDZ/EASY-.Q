/**
 * OnboardingPage — multi-step onboarding wizard for new restaurants.
 *
 * Steps:
 *  1. Restaurant info (name, address, phone)
 *  2. Upload menu (OCR PDF) or use demo data
 *  3. Create tables (bulk)
 *  4. Celebration (confetti + done)
 */

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store, Upload, Table2, CheckCircle2,
  Loader2, ArrowRight, ArrowLeft, Sparkles,
} from 'lucide-react';
import { api } from '../../api';

// ---------------------------------------------------------------------------
// Confetti (lightweight CSS-based, no library)
// ---------------------------------------------------------------------------

function Confetti() {
  const colors = ['#000', '#444', '#888', '#bbb', '#ddd'];
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {Array.from({ length: 30 }).map((_, i) => {
        const color = colors[i % colors.length];
        const left = `${Math.random() * 100}%`;
        const delay = `${Math.random() * 0.8}s`;
        const size = `${6 + Math.random() * 8}px`;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: '-10px',
              left,
              width: size,
              height: size,
              background: color,
              borderRadius: Math.random() > 0.5 ? '50%' : '0',
              animation: `confettiFall ${1.5 + Math.random()}s ${delay} ease-in forwards`,
              opacity: 0.8,
            }}
          />
        );
      })}
      <style>{`
        @keyframes confettiFall {
          to { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress tracker
// ---------------------------------------------------------------------------

const STEPS = [
  { id: 1, label: 'Restaurant', icon: Store },
  { id: 2, label: 'Menu',       icon: Upload },
  { id: 3, label: 'Tables',     icon: Table2 },
  { id: 4, label: 'Terminé',    icon: CheckCircle2 },
];

function ProgressTracker({ current }) {
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((step, i) => {
        const done = current > step.id;
        const active = current === step.id;
        const Icon = step.icon;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                done   ? 'bg-black border-black text-white' :
                active ? 'bg-white border-black text-black' :
                         'bg-white border-neutral-200 text-neutral-300'
              }`}>
                <Icon size={15} />
              </div>
              <span className={`text-xs ${active ? 'font-medium text-neutral-900' : done ? 'text-neutral-500' : 'text-neutral-300'}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 mb-5 ${done ? 'bg-black' : 'bg-neutral-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Restaurant info
// ---------------------------------------------------------------------------

function StepRestaurant({ onNext }) {
  const [form, setForm] = useState({ name: '', address: '', phone: '' });
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const handleNext = () => {
    if (!form.name.trim()) { setError('Le nom du restaurant est requis.'); return; }
    setError('');
    onNext({ restaurantName: form.name });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900 mb-1">Votre restaurant</h2>
        <p className="text-sm text-neutral-500">Commençons par quelques informations de base.</p>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1.5">Nom du restaurant *</label>
          <input
            type="text"
            value={form.name}
            onChange={set('name')}
            placeholder="Le Petit Bistro"
            className="w-full px-4 py-2.5 border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1.5">Adresse</label>
          <input
            type="text"
            value={form.address}
            onChange={set('address')}
            placeholder="12 Rue de la Paix, Paris"
            className="w-full px-4 py-2.5 border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1.5">Téléphone</label>
          <input
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            placeholder="+33 1 23 45 67 89"
            className="w-full px-4 py-2.5 border border-neutral-200 rounded-xl text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </div>
      </div>

      <button
        onClick={handleNext}
        className="w-full flex items-center justify-center gap-2 bg-black text-white py-3 rounded-full text-sm font-medium hover:bg-neutral-800 transition-colors"
      >
        Suivant <ArrowRight size={15} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Upload menu or use demo
// ---------------------------------------------------------------------------

function StepMenu({ onNext, onBack }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const handleUpload = async () => {
    if (!file) { setError('Sélectionnez un fichier.'); return; }
    setLoading(true);
    setError('');
    try {
      await api.uploadMenu('Mon restaurant', file, 'fr,en');
      onNext({ menuUploaded: true });
    } catch (err) {
      setError(err.message || 'Échec de l\'import.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = () => onNext({ menuUploaded: false, demo: true });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900 mb-1">Importez votre menu</h2>
        <p className="text-sm text-neutral-500">Uploadez votre carte en PDF ou image — notre IA la digitalise automatiquement.</p>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}

      {/* Upload zone */}
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full border-2 border-dashed border-neutral-200 rounded-xl p-8 text-center hover:border-neutral-400 transition-colors group"
      >
        <Upload size={24} className="mx-auto text-neutral-400 group-hover:text-neutral-600 mb-3 transition-colors" />
        <p className="text-sm text-neutral-600 font-medium">{file ? file.name : 'Cliquez ou glissez un fichier PDF / image'}</p>
        <p className="text-xs text-neutral-400 mt-1">PDF, JPG, PNG — max 10 Mo</p>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="hidden"
      />

      <div className="flex flex-col gap-2">
        <button
          onClick={handleUpload}
          disabled={!file || loading}
          className="w-full flex items-center justify-center gap-2 bg-black text-white py-3 rounded-full text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <>Importer le menu <ArrowRight size={15} /></>}
        </button>
        <button
          onClick={handleDemo}
          className="w-full py-2.5 border border-neutral-200 rounded-full text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Utiliser les données de démonstration
        </button>
      </div>

      <button onClick={onBack} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 transition-colors">
        <ArrowLeft size={12} /> Retour
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Create tables
// ---------------------------------------------------------------------------

function StepTables({ onNext, onBack }) {
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (count < 1 || count > 100) { setError('Entre 1 et 100 tables.'); return; }
    setLoading(true);
    setError('');
    try {
      const tables = Array.from({ length: count }, (_, i) => ({ number: i + 1 }));
      await api.createTablesBulk({ tables });
      onNext({ tablesCreated: count });
    } catch (err) {
      setError(err.message || 'Impossible de créer les tables.');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => onNext({ tablesCreated: 0 });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900 mb-1">Créez vos tables</h2>
        <p className="text-sm text-neutral-500">Chaque table aura son propre QR code unique.</p>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}

      <div>
        <label className="block text-xs font-medium text-neutral-600 mb-1.5">Nombre de tables</label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCount((c) => Math.max(1, c - 1))}
            className="w-9 h-9 border border-neutral-200 rounded-full text-lg text-neutral-600 hover:bg-neutral-50 flex items-center justify-center"
          >
            −
          </button>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
            className="w-20 text-center text-2xl font-semibold text-neutral-900 border border-neutral-200 rounded-xl py-2 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <button
            onClick={() => setCount((c) => Math.min(100, c + 1))}
            className="w-9 h-9 border border-neutral-200 rounded-full text-lg text-neutral-600 hover:bg-neutral-50 flex items-center justify-center"
          >
            +
          </button>
        </div>
        <p className="text-xs text-neutral-400 mt-2">{count} table{count !== 1 ? 's' : ''} seront créées (Table 1 → Table {count})</p>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-black text-white py-3 rounded-full text-sm font-medium hover:bg-neutral-800 transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <>Créer les tables <ArrowRight size={15} /></>}
        </button>
        <button
          onClick={handleSkip}
          className="w-full py-2.5 border border-neutral-200 rounded-full text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Passer cette étape
        </button>
      </div>

      <button onClick={onBack} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 transition-colors">
        <ArrowLeft size={12} /> Retour
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Celebration
// ---------------------------------------------------------------------------

function StepDone({ data }) {
  const navigate = useNavigate();
  return (
    <div className="text-center space-y-6">
      <Confetti />
      <div className="flex justify-center">
        <div className="w-20 h-20 bg-black rounded-full flex items-center justify-center">
          <Sparkles size={32} className="text-white" />
        </div>
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
          {data.restaurantName ? `Bienvenue, ${data.restaurantName} !` : 'Vous êtes prêt !'}
        </h2>
        <p className="text-sm text-neutral-500 max-w-xs mx-auto">
          Votre restaurant est configuré. Votre menu digital est prêt à être scanné.
        </p>
      </div>

      {data.tablesCreated > 0 && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 text-sm text-neutral-600">
          <strong>{data.tablesCreated} tables</strong> créées avec leurs QR codes.
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          onClick={() => navigate('/restaurant/dashboard')}
          className="w-full bg-black text-white py-3 rounded-full text-sm font-medium hover:bg-neutral-800 transition-colors"
        >
          Aller au tableau de bord
        </button>
        <button
          onClick={() => navigate('/upload')}
          className="w-full border border-neutral-200 py-2.5 rounded-full text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Importer un nouveau menu
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({});

  const next = (stepData = {}) => {
    const newData = { ...data, ...stepData };
    setData(newData);
    const nextStep = step + 1;
    setStep(nextStep);

    // On reaching the celebration step, log onboarding completion
    if (nextStep === 4) {
      fetch('/api/v1/restaurants/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_name: newData.restaurantName || 'Restaurant',
          tables_created: newData.tablesCreated || 0,
          menu_uploaded: newData.menuUploaded || false,
          demo: newData.demo || false,
        }),
      }).catch(() => {}); // Non-critical
    }
  };
  const back = () => setStep((s) => Math.max(1, s - 1));

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-black text-white">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center">
          <span className="font-semibold">EASY.Q</span>
          <span className="ml-2 text-neutral-400 text-sm">· Installation</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-10">
        <ProgressTracker current={step} />

        <div className="bg-white border border-neutral-200 rounded-xl p-7">
          {step === 1 && <StepRestaurant onNext={next} />}
          {step === 2 && <StepMenu onNext={next} onBack={back} />}
          {step === 3 && <StepTables onNext={next} onBack={back} />}
          {step === 4 && <StepDone data={data} />}
        </div>
      </main>
    </div>
  );
}
