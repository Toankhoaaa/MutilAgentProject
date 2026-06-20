import Head from "next/head";
import { useEffect } from "react";
import { useRouter } from "next/router";
import api from "@/lib/axios";

export default function LoginPage() {
  const router = useRouter();
  const { error } = router.query;

  // If already authenticated, redirect based on role
  useEffect(() => {
    api.get("/auth/me")
      .then((res) => router.replace(res.data.is_admin ? "/admin" : "/emails"))
      .catch(() => { /* not logged in, stay on login page */ });
  }, [router]);

  const handleGoogleLogin = () => {
    window.location.href = "/api/v1/auth/login";
  };

  return (
    <>
      <Head>
        <title>Sign In — Email Orchestrator</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-indigo-600/10 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-violet-600/10 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          {/* Card */}
          <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 p-8">
            {/* Logo */}
            <div className="flex flex-col items-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-200">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-slate-800">Email Orchestrator</h1>
              <p className="text-slate-500 text-sm mt-1 text-center">
                AI-powered multi-agent email management
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-100 rounded-lg">
                <p className="text-sm text-rose-600 text-center">
                  {error === "oauth_failed"
                    ? "Google sign-in failed. Please try again."
                    : "Authentication error. Please try again."}
                </p>
              </div>
            )}

            {/* Sign in section */}
            <div className="space-y-4">
              <button
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
              >
                {/* Google SVG */}
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>
            </div>

            {/* Features */}
            <div className="mt-8 pt-6 border-t border-slate-100">
              <p className="text-xs text-slate-400 font-medium text-center uppercase tracking-wide mb-4">
                What you get
              </p>
              <div className="space-y-2.5">
                {[
                  ["Automatic email classification", "indigo"],
                  ["AI-powered reply drafts", "violet"],
                  ["Real-time processing pipeline", "emerald"],
                ].map(([text, color]) => (
                  <div key={text} className="flex items-center gap-2.5">
                    <div className={`w-5 h-5 rounded-full bg-${color}-100 flex items-center justify-center flex-shrink-0`}>
                      <svg className={`w-3 h-3 text-${color}-600`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-sm text-slate-600">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-slate-500 mt-4">
            Your data is processed securely via Google OAuth.
          </p>
        </div>
      </div>
    </>
  );
}
