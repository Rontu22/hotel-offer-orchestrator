import type { HotelOffer } from "@/lib/hotels";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function OffersTable({ offers }: { offers: HotelOffer[] }) {
  if (offers.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-black/15 dark:border-white/20 p-8 text-center text-sm opacity-60">
        No hotels matched. Try widening the price range or another city.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Best available offer per hotel</caption>
      <thead>
        <tr className="border-b border-black/10 dark:border-white/15 text-left">
          <th scope="col" className="py-2.5 font-medium">Hotel</th>
          <th scope="col" className="py-2.5 font-medium">Supplier</th>
          <th scope="col" className="py-2.5 font-medium text-right">Commission</th>
          <th scope="col" className="py-2.5 font-medium text-right">Price</th>
        </tr>
      </thead>
      <tbody>
        {offers.map((offer) => (
          <tr key={offer.name} className="border-b border-black/5 dark:border-white/10">
            <td className="py-3">{offer.name}</td>
            <td className="py-3 opacity-70">{offer.supplier}</td>
            <td className="py-3 text-right opacity-70">{offer.commissionPct}%</td>
            <td className="py-3 text-right font-medium tabular-nums">{money.format(offer.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
