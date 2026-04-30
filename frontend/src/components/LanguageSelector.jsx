import { Globe } from 'lucide-react';

const LANG_LABELS = {
  en: 'EN',
  fr: 'FR',
  es: 'ES',
};

export default function LanguageSelector({ current, available, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <Globe className="h-4 w-4 text-neutral-400" />
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-white text-sm font-medium cursor-pointer border-none outline-none appearance-none"
      >
        {available.map((lang) => (
          <option key={lang} value={lang} className="text-black">
            {LANG_LABELS[lang] || lang.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
