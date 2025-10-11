import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/contexts/WalletContext";
import { FheProvider } from "@/contexts/FheContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import FheScriptLoader from "@/components/FheScriptLoader";
import BackgroundMusic from "@/components/BackgroundMusic";
import NotificationContainer from "@/components/NotificationContainer";

export const metadata: Metadata = {
  title: "NFT Dark Forest - Zama FHE Battle Game",
  description: "NFT battle game powered by Zama fully homomorphic encryption",
  icons: {
    icon: "/icons/pixel-eye-red.svg",
    shortcut: "/icons/pixel-eye-red.svg",
    apple: "/icons/pixel-eye-red.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased bg-gray-950 text-white">
        <FheScriptLoader />
        <FheProvider>
          <WalletProvider>
            <NotificationProvider>
              {children}
              <NotificationContainer />
            </NotificationProvider>
          </WalletProvider>
        </FheProvider>
        <BackgroundMusic />
      </body>
    </html>
  );
}
