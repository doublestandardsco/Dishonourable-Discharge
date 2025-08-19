// lib/characters.ts
export type Ability = { id: string; name: string; desc: string; uses: number };
export type Character = {
  id: string;
  codename: string;
  aliasName: string;      // the adopted name for the character (you asked for this)
  cover: string;
  background: string;
  discharge: string;
  secret: string;
  oddity: string;         // “quirk”
  perks: string[];
  con: string;
  ability: Ability;
  publicBio: string;      // NEW
  privateBio: string;     // NEW
};

export const characters: Character[] = [
  // ✳️ Paste your 12 characters here (the 12 we produced earlier).
  // Example for one entry shape:
  /*
  {
    id: "lacehunter",
    codename: "LACEHUNTER",
    aliasName: "Val Dupont",
    cover: "Luxury Skiwear Designer",
    background: "...",
    discharge: "...",
    secret: "...",
    oddity: "...",
    perks: ["...", "..."],
    con: "...",
    ability: { id: "fashion_emergency", name: "Fashion Emergency", desc: "Force any two players to swap one visible clothing item immediately.", uses: 1 },
    publicBio: "Short, PG-13 summary seen by all.",
    privateBio: "Full chaotic R-rated version shown only to Val."
  },
  */
];
