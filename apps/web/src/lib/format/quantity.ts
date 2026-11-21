const quantityFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// A share/contract count, pt-BR thousands separator (DESIGN.md's formatting rule), never a
// decimal — a quantity is always a whole number of shares or contracts.
export function formatQuantity(quantity: number): string {
  return quantityFormatter.format(quantity);
}
