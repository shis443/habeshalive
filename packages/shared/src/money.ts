const SANTIM_PER_BIRR = 100;

export function santimToBirr(santim: number): number {
  return santim / SANTIM_PER_BIRR;
}

export function birrToSantim(birr: number): number {
  return Math.round(birr * SANTIM_PER_BIRR);
}

export function formatSantimAsBirr(santim: number): string {
  return `${santimToBirr(santim).toLocaleString("en-ET", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ETB`;
}
