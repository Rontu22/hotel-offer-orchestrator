/**
 * Seed rows for the two supplier databases. Names overlap on purpose so the
 * orchestrator's comparison has something to do; each supplier wins on at least
 * one hotel. Written to Postgres once, on first boot against an empty table —
 * after that the database is the source of truth and this file is only history.
 */
export const CATALOGUE = {
  supplierA: [
    { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
    { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
    { hotelId: 'a3', name: 'Tajmahal Palace', price: 12400, city: 'delhi', commissionPct: 8 },
    { hotelId: 'a4', name: 'Oberon', price: 9100, city: 'delhi', commissionPct: 15 },
    { hotelId: 'a5', name: 'Holtin', price: 8200, city: 'mumbai', commissionPct: 10 },
    { hotelId: 'a6', name: 'Sea Rock', price: 7300, city: 'mumbai', commissionPct: 11 },
    { hotelId: 'a7', name: 'Leela Gardens', price: 4300, city: 'bangalore', commissionPct: 9 },
  ],
  supplierB: [
    { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
    { hotelId: 'b2', name: 'Radison', price: 6450, city: 'delhi', commissionPct: 18 },
    { hotelId: 'b3', name: 'Imperial Court', price: 3100, city: 'delhi', commissionPct: 22 },
    { hotelId: 'b4', name: 'Oberon', price: 9100, city: 'delhi', commissionPct: 12 },
    { hotelId: 'b5', name: 'Holtin', price: 7950, city: 'mumbai', commissionPct: 19 },
    { hotelId: 'b6', name: 'Marine Bay', price: 6600, city: 'mumbai', commissionPct: 14 },
    { hotelId: 'b7', name: 'Leela Gardens', price: 4700, city: 'bangalore', commissionPct: 16 },
  ],
};
