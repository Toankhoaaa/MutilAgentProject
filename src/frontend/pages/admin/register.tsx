import Head from "next/head";
import { useState } from "react";
import { useRouter } from "next/router";
import api from "@/lib/axios";

type FormState = {
  display_name: string;
  email: string;
  password: string;
  secret_key: string;
};

export default function AdminRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    display_name: "",
    email: "",
    password: "",
    secret_key: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/admin/register", form);
      setSuccess(true);
      setTimeout(() => router.push("/admin/login"), 1500);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail ?? "Registration failed. Please check your details and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Admin Registration — Email Orchestrator</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-indigo-600/10 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-violet-600/10 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 p-8">
            {/* Header */}
            <div className="flex flex-col items-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-200">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-slate-800">Create Admin Account</h1>
              <p className="text-slate-500 text-sm mt-1 text-center">Protected by a server-side registration secret</p>
            </div>

            {/* Success banner */}
            {success && (
              <div className="mb-5 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                <p className="text-sm text-emerald-700 text-center font-medium">
                  Account created! Redirecting to login...
                </p>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="mb-5 px-4 py-3 bg-rose-50 border border-rose-100 rounded-xl">
                <p className="text-sm text-rose-600 text-center">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  name="display_name"
                  value={form.display_name}
                  onChange={handleChange}
                  required
                  placeholder="Admin User"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  autoComplete="email"
                  placeholder="admin@example.com"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Registration Secret Key
                </label>
                <input
                  type="password"
                  name="secret_key"
                  value={form.secret_key}
                  onChange={handleChange}
                  required
                  placeholder="Server-provided secret"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  Set via <code className="font-mono">ADMIN_REGISTRATION_SECRET</code> in your server environment.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || success}
                className="w-full mt-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creating account...
                  </>
                ) : "Create Admin Account"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              Already registered?{" "}
              <a href="/admin/login" className="text-indigo-600 hover:underline font-medium">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
