import { useState } from 'react';
import { Upload, QrCode, Loader2, CheckCircle, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function HomePage() {
  const [restaurantName, setRestaurantName] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !restaurantName.trim()) return;
    
    setLoading(true);
    setError('');
    setResult(null);
    
    try {
      const data = await api.uploadMenu(restaurantName.trim(), file);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-black text-white">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">EasyQ</h1>
            <p className="text-sm text-neutral-400">Digital Menu Platform</p>
          </div>
          <Link to="/restaurant/dashboard" className="text-sm text-neutral-200 hover:text-white">
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-900 mb-2">Upload Menu</h2>
            <p className="text-neutral-500">Upload a PDF menu to generate a QR code</p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Restaurant Name
              </label>
              <input
                type="text"
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                placeholder="Enter restaurant name"
                className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-lg focus:ring-2 focus:ring-black focus:border-black outline-none text-neutral-900"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Menu PDF
              </label>
              <div className="border border-neutral-200 rounded-lg p-8 text-center hover:border-neutral-400 transition-colors bg-white">
                <input
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setFile(e.target.files[0])}
                  className="hidden"
                  id="pdf-upload"
                  required
                />
                <label htmlFor="pdf-upload" className="cursor-pointer">
                  <Upload className="mx-auto h-10 w-10 text-neutral-400 mb-3" />
                  {file ? (
                    <p className="text-neutral-900 font-medium">{file.name}</p>
                  ) : (
                    <p className="text-neutral-500">Click to upload PDF menu</p>
                  )}
                </label>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !file || !restaurantName.trim()}
              className="w-full bg-black text-white py-3 px-6 rounded-lg font-medium hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <QrCode className="h-5 w-5" />
                  Generate QR Code
                </>
              )}
            </button>
          </form>

          {result && (
            <div className="mt-8 p-6 bg-neutral-100 rounded-lg border border-neutral-200">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="h-5 w-5 text-neutral-800" />
                <span className="font-medium text-neutral-900">Menu Created Successfully</span>
              </div>
              
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-neutral-500 mb-1">Public URL:</p>
                  <div className="flex items-center gap-2">
                    <a 
                      href={result.public_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-neutral-900 font-medium hover:underline break-all"
                    >
                      {result.public_url}
                    </a>
                    <button 
                      onClick={() => copyToClipboard(result.public_url)}
                      className="p-1 hover:bg-neutral-200 rounded"
                    >
                      <Copy className="h-4 w-4 text-neutral-500" />
                    </button>
                  </div>
                </div>
                
                <div>
                  <p className="text-sm text-neutral-500 mb-2">QR Code:</p>
                  <img 
                    src={result.qr_url} 
                    alt="Menu QR Code" 
                    className="w-48 h-48 border border-neutral-200 rounded-lg bg-white"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
