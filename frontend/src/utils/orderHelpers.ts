import { Order } from "@/src/constants";

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO);
  const b = new Date(toISO);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function returnDaysLeft(order: Order): number | null {
  if (!order.return_deadline) return null;
  if (
    order.status === "Cancelled" ||
    order.status === "Returned" ||
    order.status === "Exchanged"
  ) {
    return null;
  }
  const now = todayISO();
  return daysBetween(now, order.return_deadline);
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function formatINR(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "₹0";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function isCurrentMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  );
}

export function isInTransit(status: string): boolean {
  return (
    status === "Ordered" || status === "Shipped" || status === "Out for Delivery"
  );
}
