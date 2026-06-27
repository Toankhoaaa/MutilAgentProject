import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Geist, Geist_Mono } from "next/font/google";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
  weight: "400",
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${geist.variable} ${geistMono.variable}`}>
      <Component {...pageProps} />
    </div>
  );
}
