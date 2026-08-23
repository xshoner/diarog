"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "오늘", icon: "🏠" },
  { href: "/weekly", label: "회고", icon: "🗓️" },
  { href: "/upload", label: "", icon: "＋", fab: true },
  { href: "/search", label: "검색", icon: "🔍" },
  { href: "/settings", label: "설정", icon: "⚙️" },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-card/90 backdrop-blur border-t border-line z-40"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center justify-around h-16">
        {items.map((it) =>
          it.fab ? (
            <Link key={it.href} href={it.href} aria-label="사진 추가"
              className="flex items-center justify-center w-13 h-13 -mt-6 rounded-full bg-accent text-white text-2xl font-light shadow-lg shadow-accent/30 active:scale-95 transition-transform">
              {it.icon}
            </Link>
          ) : (
            <Link key={it.href} href={it.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 text-[11px] transition-colors ${
                path === it.href ? "text-accent font-semibold" : "text-ink-soft"
              }`}>
              <span className="text-lg leading-none">{it.icon}</span>
              {it.label}
            </Link>
          )
        )}
      </div>
    </nav>
  );
}
