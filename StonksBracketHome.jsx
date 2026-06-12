"use client";

// StonksBracketHome — World Cup 2026 bracket homepage
// Drop-in React component for Next.js (App Router or Pages Router).
//
// FONTS: this design uses Google Fonts "Archivo" and "Archivo Narrow".
// Easiest option — add this to your root layout's <head> (app/layout.jsx):
//   <link rel="preconnect" href="https://fonts.googleapis.com" />
//   <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
//   <link
//     href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Archivo+Narrow:wght@500;600;700&display=swap"
//     rel="stylesheet"
//   />
// (Or wire up next/font/google with Archivo + Archivo_Narrow and pass the className.)
//
// Usage:  import StonksBracketHome from "@/components/StonksBracketHome";
//         export default function Page() { return <StonksBracketHome />; }

import { useState } from "react";

const COLORS = {
  bgDark: "#0b3d2c",
  bgLight: "#115c41",
  cream: "#f4f1e8",
  gold: "#e6b337",
  goldHover: "#f0c552",
  goldSoft: "#f0d38a",
  textMuted: "#c4d8cd",
  textDim: "#8fb0a1",
  navDim: "#a9c6b8",
};

const PLAYERS = [
  { name: "Carlos", initial: "C", color: "#e6b337" },
  { name: "Sebas", initial: "S", color: "#7fc8a9" },
  { name: "Mauri", initial: "M", color: "#c9a0dc" },
  { name: "Joaquin", initial: "J", color: "#e89a7c" },
];

const sans = "'Archivo', sans-serif";
const narrow = "'Archivo Narrow', sans-serif";

export default function StonksBracketHome() {
  const [hovered, setHovered] = useState(null); // "primary" | "secondary" | player index | null

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bgDark,
        backgroundImage: `radial-gradient(circle at 20% 0%, ${COLORS.bgLight} 0%, ${COLORS.bgDark} 55%)`,
        fontFamily: sans,
        color: COLORS.cream,
        boxSizing: "border-box",
      }}
    >
      {/* top bar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "22px 36px",
          borderBottom: "1px solid rgba(244,241,232,0.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: COLORS.cream,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            ⚽
          </div>
          <span
            style={{
              fontFamily: narrow,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              fontSize: 14,
              color: "#d8e8df",
            }}
          >
            Stonks©
          </span>
        </div>
        <nav
          style={{
            display: "flex",
            gap: 26,
            fontFamily: narrow,
            fontWeight: 600,
            fontSize: 14,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: COLORS.navDim,
          }}
        >
          <a style={{ color: "#d8e8df", cursor: "pointer", textDecoration: "none" }}>Bracket</a>
          <a style={{ color: COLORS.textDim, cursor: "pointer", textDecoration: "none" }}>Standings</a>
          <a style={{ color: COLORS.textDim, cursor: "pointer", textDecoration: "none" }}>Rules</a>
        </nav>
      </header>

      {/* hero */}
      <section style={{ maxWidth: 1040, margin: "0 auto", padding: "70px 36px 40px", textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 16px",
            borderRadius: 999,
            background: "rgba(230,179,55,0.16)",
            border: "1px solid rgba(230,179,55,0.4)",
            marginBottom: 28,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: COLORS.gold }} />
          <span
            style={{
              fontFamily: narrow,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontSize: 12,
              color: COLORS.goldSoft,
            }}
          >
            World Cup 2026 · USA · Canada · Mexico
          </span>
        </div>

        <h1
          style={{
            fontSize: 76,
            lineHeight: 0.98,
            fontWeight: 900,
            margin: "0 0 18px",
            letterSpacing: "-0.02em",
            textWrap: "balance",
            color: COLORS.gold,
          }}
        >
          Stonks
          <br />
          Bracket.
        </h1>

        <p
          style={{
            fontSize: 19,
            lineHeight: 1.5,
            color: COLORS.textMuted,
            maxWidth: 540,
            margin: "0 auto 34px",
            textWrap: "pretty",
          }}
        >
          El que sale último es el más pendejo.
        </p>

        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onMouseEnter={() => setHovered("primary")}
            onMouseLeave={() => setHovered(null)}
            style={{
              fontFamily: sans,
              fontWeight: 800,
              fontSize: 16,
              padding: "16px 30px",
              borderRadius: 12,
              border: "none",
              background: hovered === "primary" ? COLORS.goldHover : COLORS.gold,
              color: COLORS.bgDark,
              cursor: "pointer",
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
              width: 230,
            }}
          >
            Fill out my bracket →
          </button>
          <button
            onMouseEnter={() => setHovered("secondary")}
            onMouseLeave={() => setHovered(null)}
            style={{
              fontFamily: sans,
              fontWeight: 700,
              fontSize: 16,
              padding: "16px 30px",
              borderRadius: 12,
              border: "1px solid rgba(244,241,232,0.3)",
              background: hovered === "secondary" ? "rgba(244,241,232,0.08)" : "transparent",
              color: COLORS.cream,
              cursor: "pointer",
              whiteSpace: "nowrap",
              width: 230,
            }}
          >
            View live standings
          </button>
        </div>
      </section>

      {/* contenders */}
      <section style={{ maxWidth: 1040, margin: "0 auto", padding: "30px 36px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <span
            style={{
              fontFamily: narrow,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontSize: 13,
              color: COLORS.textDim,
            }}
          >
            The Contenders
          </span>
          <div style={{ flex: 1, height: 1, background: "rgba(244,241,232,0.12)" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {PLAYERS.map((p, i) => (
            <div
              key={p.name}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: "rgba(244,241,232,0.06)",
                border: `1px solid ${hovered === i ? "rgba(230,179,55,0.5)" : "rgba(244,241,232,0.12)"}`,
                borderRadius: 16,
                padding: "22px 20px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  margin: "0 auto 14px",
                  background: p.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 22,
                  color: COLORS.bgDark,
                }}
              >
                {p.initial}
              </div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{p.name}</div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ paddingBottom: 50 }} />
    </div>
  );
}
