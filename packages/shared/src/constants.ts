// Single source for both the API's actual charge and the frontend's
// display copy — a price shown to a user before they click and the price
// actually charged must never be able to drift apart.
export const BOOST_PRICE_SANTIM = 5_000; // 50 ETB (100 santim = 1 ETB)
export const BOOST_DURATION_MS = 60 * 60 * 1000; // 1 hour
