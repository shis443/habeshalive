// Same reasoning as ./workflows.ts — one barrel so the worker registers
// every domain's activities from a single import.
export * from "../wallet/temporal/activities.js";
export * from "../gift-cards/temporal/activities.js";
